"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const block_basekit_server_api_1 = require("@lark-opdev/block-basekit-server-api");
const jimp_1 = __importDefault(require("jimp"));
block_basekit_server_api_1.basekit.addDomainList(['feishu.cn', 'lf3-static.bytednsdoc.com', 'open.feishu.cn', 'ai.duoduolang.com', 'myqcloud.com']);
function hostOf(u) {
    try {
        return new URL(u).hostname;
    }
    catch {
        return '';
    }
}
async function requestPresigned(apiUrl, file, context) {
    const apiHost = hostOf(apiUrl);
    if (apiHost)
        block_basekit_server_api_1.basekit.addDomainList([apiHost]);
    const query = new URLSearchParams({
        fileName: file.name,
        contentType: file.mimeType,
        fileExtension: file.extension,
    });
    const q = query.toString();
    const base = apiUrl.replace(/[?#].*$/, '');
    const hasScheme = /^https?:\/\//i.test(base);
    const httpsBase = hasScheme ? base : `https://${base}`;
    const httpBase = httpsBase.replace(/^https:/i, 'http:');
    const candidates = [
        `${httpsBase}?${q}`,
        `${httpsBase.endsWith('/') ? httpsBase : httpsBase + '/'}?${q}`,
        `${httpBase}?${q}`,
        `${httpBase.endsWith('/') ? httpBase : httpBase + '/'}?${q}`,
    ];
    const attempts = [];
    for (let i = 0; i < candidates.length; i++) {
        const url = candidates[i];
        try {
            const res = await context.fetch(url, { method: 'GET' });
            attempts.push(`${url} -> ${res.status}`);
            if (!res.ok)
                continue;
            let j;
            try {
                j = await res.json();
            }
            catch {
                attempts.push(`${url} -> json parse error`);
                continue;
            }
            const d = j?.data ?? j;
            if ((typeof j?.code === 'number' && j.code !== 200) || !d) {
                attempts.push(`${url} -> code ${j?.code} msg ${j?.msg || ''}`);
                continue;
            }
            const uploadUrl = d?.url;
            const permanentUrl = d?.fileUrl || d?.file_url;
            const method = (d?.method || 'PUT').toUpperCase();
            const contentType = d?.contentType || file.mimeType;
            const headers = d?.headers || {};
            if (!uploadUrl || !permanentUrl) {
                attempts.push(`${url} -> missing url/fileUrl`);
                continue;
            }
            return { uploadUrl, permanentUrl, method, headers, contentType };
        }
        catch (e) {
            attempts.push(`${url} -> ${String(e?.message || e)}`);
            continue;
        }
    }
    throw new Error(`presign failed all: ${attempts.join(' | ')}`);
}
async function putToPresigned(uploadUrl, buf, mimeType, method, headers, context) {
    const host = hostOf(uploadUrl);
    if (host)
        block_basekit_server_api_1.basekit.addDomainList([host]);
    let url = uploadUrl;
    try {
        const u = new URL(uploadUrl);
        const sign = u.searchParams.get('sign');
        const hasContentTypeParam = u.searchParams.has('content-type') || u.searchParams.has('Content-Type');
        const signDecoded = sign ? decodeURIComponent(sign) : '';
        const signNeedsContentType = signDecoded.includes('q-url-param-list=content-type');
        if (signNeedsContentType && !hasContentTypeParam) {
            u.searchParams.set('content-type', mimeType);
            url = u.toString();
        }
    }
    catch { }
    const res = await context.fetch(url, {
        method,
        headers: { 'Content-Type': mimeType, ...headers },
        body: buf,
    });
    if (!res.ok && !(res.status >= 200 && res.status < 300)) {
        throw new Error(`upload to cos failed ${res.status}`);
    }
}
async function sliceUploadAll(att, fmt, context, apiUrl) {
    const srcHost = hostOf(att.tmp_url);
    if (srcHost)
        block_basekit_server_api_1.basekit.addDomainList([srcHost]);
    const resp = await context.fetch(att.tmp_url, { method: 'GET' });
    if (!resp.ok) {
        throw new Error(`download failed ${resp.status || ''}`);
    }
    const buf = await resp.buffer();
    const img = await jimp_1.default.read(buf);
    const w = img.bitmap.width;
    const h = img.bitmap.height;
    const w3 = Math.floor(w / 3);
    const h3 = Math.floor(h / 3);
    const mime = fmt === 'jpg' ? jimp_1.default.MIME_JPEG : jimp_1.default.MIME_PNG;
    const ct = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
    const slices = [];
    const dims = [];
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            const cw = c < 2 ? w3 : w - 2 * w3;
            const ch = r < 2 ? h3 : h - 2 * h3;
            const piece = img.clone().crop(c * w3, r * h3, cw, ch);
            if (fmt === 'jpg')
                piece.quality(85);
            let b = await piece.getBufferAsync(mime);
            if (b.length > 10 * 1024 * 1024 && fmt === 'jpg') {
                piece.quality(70);
                b = await piece.getBufferAsync(mime);
            }
            if (b.length > 10 * 1024 * 1024 && fmt === 'jpg') {
                piece.quality(55);
                b = await piece.getBufferAsync(mime);
            }
            slices.push(b);
            dims.push({ width: cw, height: ch });
        }
    }
    const files = slices.map((buf, i) => {
        const base = (att.name || 'image').replace(/\.[^.]+$/, '');
        const filename = `${base}_part${i + 1}.${fmt}`;
        return { name: filename, file: buf, mimeType: ct };
    });
    if (apiUrl) {
        const links = [];
        for (let i = 0; i < files.length; i++) {
            const extension = files[i].name.split('.').pop() || (fmt === 'jpg' ? 'jpg' : 'png');
            const spec = await requestPresigned(apiUrl, { name: files[i].name, mimeType: files[i].mimeType, size: files[i].file.length, extension }, context);
            await putToPresigned(spec.uploadUrl, files[i].file, spec.contentType, spec.method, spec.headers || {}, context);
            links.push({ mode: 'url', value: spec.permanentUrl, width: dims[i].width, height: dims[i].height, name: files[i].name });
        }
        return links;
    }
    else {
        throw new Error('apiUrl is required to get COS presigned URL');
    }
}
block_basekit_server_api_1.basekit.addField({
    formItems: [
        {
            key: 'attachments',
            label: '选择图片附件',
            component: block_basekit_server_api_1.FieldComponent.FieldSelect,
            props: {
                supportType: [block_basekit_server_api_1.FieldType.Attachment],
                mode: 'single',
            },
            validator: {
                required: true,
            }
        },
        {
            key: 'format',
            label: '输出格式',
            component: block_basekit_server_api_1.FieldComponent.SingleSelect,
            props: {
                options: [
                    { label: 'PNG', value: 'png' },
                    { label: 'JPEG', value: 'jpg' },
                ],
            },
            defaultValue: { label: 'PNG', value: 'png' },
            validator: {
                required: true,
            }
        },
        {
            key: 'apiUrl',
            label: '上传API URL',
            component: block_basekit_server_api_1.FieldComponent.Input,
            props: {},
            defaultValue: 'https://ai.duoduolang.com/ai/cos/credentialv1',
            validator: {
                required: false,
            }
        },
        {
            key: 'stage',
            label: '输出阶段',
            component: block_basekit_server_api_1.FieldComponent.SingleSelect,
            props: {
                options: [
                    { label: '阶段1（4张）', value: '1' },
                    { label: '阶段2（5张）', value: '2' },
                ],
            },
            defaultValue: { label: '阶段1（4张）', value: '1' },
            validator: {
                required: true,
            }
        },
    ],
    resultType: {
        type: block_basekit_server_api_1.FieldType.Attachment,
    },
    execute: async (formItemParams, context) => {
        const att = formItemParams?.attachments?.[0];
        const fmt = formItemParams?.format?.value || 'png';
        const apiUrl = typeof formItemParams?.apiUrl === 'string' && formItemParams.apiUrl ? formItemParams.apiUrl : 'https://ai.duoduolang.com/ai/cos/credentialv1';
        if (!att?.tmp_url)
            return { code: block_basekit_server_api_1.FieldCode.Error, msg: 'missing attachment tmp_url' };
        try {
            const host = hostOf(att.tmp_url);
            if (host)
                block_basekit_server_api_1.basekit.addDomainList([host]);
            const results = await sliceUploadAll(att, fmt, context, apiUrl);
            const stage = formItemParams?.stage?.value || '1';
            const sel = stage === '1' ? results.slice(0, 4) : results.slice(4, 9);
            const items = sel.map((r) => ({
                name: r.name,
                content: r.value,
                contentType: 'attachment/url',
                width: r.width,
                height: r.height,
            }));
            if (!items.length)
                return { code: block_basekit_server_api_1.FieldCode.Error, msg: 'slice/upload produced empty result' };
            return { code: block_basekit_server_api_1.FieldCode.Success, data: items };
        }
        catch (e) {
            return { code: block_basekit_server_api_1.FieldCode.ConfigError, msg: String(e?.message || e) };
        }
    },
});
exports.default = block_basekit_server_api_1.basekit;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxtRkFBcUc7QUFDckcsZ0RBQXdCO0FBR3hCLGtDQUFPLENBQUMsYUFBYSxDQUFDLENBQUMsV0FBVyxFQUFFLDJCQUEyQixFQUFFLGdCQUFnQixFQUFFLG1CQUFtQixFQUFFLGNBQWMsQ0FBQyxDQUFDLENBQUM7QUFFekgsU0FBUyxNQUFNLENBQUMsQ0FBUztJQUN2QixJQUFJLENBQUM7UUFDSCxPQUFPLElBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLFFBQVEsQ0FBQztJQUM3QixDQUFDO0lBQUMsTUFBTSxDQUFDO1FBQ1AsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0FBQ0gsQ0FBQztBQUdELEtBQUssVUFBVSxnQkFBZ0IsQ0FBQyxNQUFjLEVBQUUsSUFBeUUsRUFBRSxPQUFZO0lBQ3JJLE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUMvQixJQUFJLE9BQU87UUFBRSxrQ0FBTyxDQUFDLGFBQWEsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7SUFDOUMsTUFBTSxLQUFLLEdBQUcsSUFBSSxlQUFlLENBQUM7UUFDaEMsUUFBUSxFQUFFLElBQUksQ0FBQyxJQUFJO1FBQ25CLFdBQVcsRUFBRSxJQUFJLENBQUMsUUFBUTtRQUMxQixhQUFhLEVBQUUsSUFBSSxDQUFDLFNBQVM7S0FDOUIsQ0FBQyxDQUFDO0lBQ0gsTUFBTSxDQUFDLEdBQUcsS0FBSyxDQUFDLFFBQVEsRUFBRSxDQUFDO0lBQzNCLE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQzNDLE1BQU0sU0FBUyxHQUFHLGVBQWUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDN0MsTUFBTSxTQUFTLEdBQUcsU0FBUyxDQUFD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LElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztJQUNoQyxNQUFNLEdBQUcsR0FBRyxNQUFNLGNBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDakMsTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUM7SUFDM0IsTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUM7SUFDNUIsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDN0IsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDN0IsTUFBTSxJQUFJLEdBQUcsR0FBRyxLQUFLLEtBQUssQ0FBQyxDQUFDLENBQUMsY0FBSSxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsY0FBSSxDQUFDLFFBQVEsQ0FBQztJQUM1RCxNQUFNLEVBQUUsR0FBRyxHQUFHLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQztJQUN0RCxNQUFNLE1BQU0sR0FBYSxFQUFFLENBQUM7SUFDNUIsTUFBTSxJQUFJLEdBQXdDLEVBQUUsQ0FBQztJQUNyRCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7UUFDM0IsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQzNCLE1BQU0sRUFBRSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDbkMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNuQyxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDdkQsSUFBSSxHQUFHLEtBQUssS0FBSztnQkFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBQ3JDLElBQUksQ0FBQyxHQUFHLE1BQU0sS0FBSyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUN6QyxJQUFJLENBQUMsQ0FBQyxNQUFNLEdBQUcsRUFBRSxHQUFHLElBQUksR0FBRyxJQUFJLElBQUksR0FBRyxLQUFLLEtBQUssRUFBRSxDQUFDO2dCQUNqRCxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUNsQixDQUFDLEdBQUcsTUFBTSxLQUFLLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3ZDLENBQUM7WUFDRCxJQUFJLENBQUMsQ0FBQyxNQUFNLEdBQUcsRUFBRSxHQUFHLElBQUksR0FBRyxJQUFJLElBQUksR0FBRyxLQUFLLEtBQUssRUFBRSxDQUFDO2dCQUNqRCxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDO2dCQUNsQixDQUFDLEdBQUcsTUFBTSxLQUFLLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3ZDLENBQUM7WUFDRCxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2YsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDdkMsQ0FBQztJQUNILENBQUM7SUFDRCxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUMsRUFBRSxFQUFFO1FBQ2xDLE1BQU0sSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLElBQUksSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBQzNELE1BQU0sUUFBUSxHQUFHLEdBQUcsSUFBSSxRQUFRLENBQUMsR0FBRyxDQUFDLElBQUksR0FBRyxFQUFFLENBQUM7UUFDL0MsT0FBTyxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUUsRUFBRSxFQUFFLENBQUM7SUFDckQsQ0FBQyxDQUFDLENBQUM7SUFDSCxJQUFJLE1BQU0sRUFBRSxDQUFDO1FBQ1gsTUFBTSxLQUFLLEdBQWtGLEVBQUUsQ0FBQztRQUNoRyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQ3RDLE1BQU0sU0FBUyxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRyxLQUFLLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNwRixNQUFNLElBQUksR0FBRyxNQUFNLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUSxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsRUFBRSxPQUFPLENBQUMsQ0FBQztZQUNsSixNQUFNLGNBQWMsQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksQ0FB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