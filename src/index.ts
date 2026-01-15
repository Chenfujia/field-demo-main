import { basekit, FieldType, FieldComponent, FieldCode } from '@lark-opdev/block-basekit-server-api';
import Jimp from 'jimp';
import FormData from 'form-data';

basekit.addDomainList(['feishu.cn', 'lf3-static.bytednsdoc.com', 'open.feishu.cn', 'ai.duoduolang.com', 'myqcloud.com']);

function hostOf(u: string) {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}


async function requestPresigned(apiUrl: string, file: { name: string; mimeType: string; size: number; extension: string }, context: any) {
  const apiHost = hostOf(apiUrl);
  if (apiHost) basekit.addDomainList([apiHost]);
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
  const attempts: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const url = candidates[i];
    try {
      const res = await context.fetch(url, { method: 'GET' });
      attempts.push(`${url} -> ${res.status}`);
      if (!res.ok) continue;
      let j: any;
      try {
        j = await res.json();
      } catch {
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
    } catch (e: any) {
      attempts.push(`${url} -> ${String(e?.message || e)}`);
      continue;
    }
  }
  throw new Error(`presign failed all: ${attempts.join(' | ')}`);
}

async function putToPresigned(uploadUrl: string, buf: Buffer, mimeType: string, method: string, headers: Record<string, string>, context: any) {
  const host = hostOf(uploadUrl);
  if (host) basekit.addDomainList([host]);
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
  } catch {}
  const res = await context.fetch(url, {
    method,
    headers: { 'Content-Type': mimeType, ...headers },
    body: buf,
  });
  if (!res.ok && !(res.status >= 200 && res.status < 300)) {
    throw new Error(`upload to cos failed ${res.status}`);
  }
}

async function sliceUploadAll(att: any, fmt: string, context: any, apiUrl?: string) {
  const srcHost = hostOf(att.tmp_url);
  if (srcHost) basekit.addDomainList([srcHost]);
  const resp = await context.fetch(att.tmp_url, { method: 'GET' });
  if (!resp.ok) {
    throw new Error(`download failed ${resp.status || ''}`);
  }
  const buf = await resp.buffer();
  const img = await Jimp.read(buf);
  const w = img.bitmap.width;
  const h = img.bitmap.height;
  const w3 = Math.floor(w / 3);
  const h3 = Math.floor(h / 3);
  const mime = fmt === 'jpg' ? Jimp.MIME_JPEG : Jimp.MIME_PNG;
  const ct = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
  const slices: Buffer[] = [];
  const dims: { width: number; height: number }[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const cw = c < 2 ? w3 : w - 2 * w3;
      const ch = r < 2 ? h3 : h - 2 * h3;
      const piece = img.clone().crop(c * w3, r * h3, cw, ch);
      if (fmt === 'jpg') piece.quality(85);
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
    const links: { mode: 'url'; value: string; width: number; height: number; name: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const extension = files[i].name.split('.').pop() || (fmt === 'jpg' ? 'jpg' : 'png');
      const spec = await requestPresigned(apiUrl, { name: files[i].name, mimeType: files[i].mimeType, size: files[i].file.length, extension }, context);
      await putToPresigned(spec.uploadUrl, files[i].file, spec.contentType, spec.method, spec.headers || {}, context);
      links.push({ mode: 'url', value: spec.permanentUrl, width: dims[i].width, height: dims[i].height, name: files[i].name });
    }
    return links;
  } else {
    throw new Error('apiUrl is required to get COS presigned URL');
  }
}

basekit.addField({
  formItems: [
    {
      key: 'attachments',
      label: '选择图片附件',
      component: FieldComponent.FieldSelect,
      props: {
        supportType: [FieldType.Attachment],
        mode: 'single',
      },
      validator: {
        required: true,
      }
    },
    {
      key: 'format',
      label: '输出格式',
      component: FieldComponent.SingleSelect,
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
      component: FieldComponent.Input,
      props: {},
      defaultValue: 'https://ai.duoduolang.com/ai/cos/credentialv1',
      validator: {
        required: false,
      }
    },
    {
      key: 'stage',
      label: '输出阶段',
      component: FieldComponent.SingleSelect,
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
    type: FieldType.Attachment,
  },
  execute: async (formItemParams: any, context) => {
    const att = formItemParams?.attachments?.[0];
    const fmt = formItemParams?.format?.value || 'png';
    const apiUrl: string | undefined = typeof formItemParams?.apiUrl === 'string' && formItemParams.apiUrl ? formItemParams.apiUrl : 'https://ai.duoduolang.com/ai/cos/credentialv1';
    if (!att?.tmp_url) return { code: FieldCode.Error, msg: 'missing attachment tmp_url' };
    try {
      const host = hostOf(att.tmp_url);
      if (host) basekit.addDomainList([host]);
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
      if (!items.length) return { code: FieldCode.Error, msg: 'slice/upload produced empty result' };
      return { code: FieldCode.Success, data: items as any };
    } catch (e: any) {
      return { code: FieldCode.ConfigError, msg: String(e?.message || e) };
    }
  },
});

export default basekit;
