import { testField, createFieldContext } from "@lark-opdev/block-basekit-server-api";
import Jimp from "jimp";

async function run() {
  const context = await createFieldContext();
  await testField({
    attachments: [{
      name: 'demo.png',
      size: 0,
      type: 'image/png',
      tmp_url: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/abjayvoz/ljhwZthlaukjlkulzlp/jingjing0619/heavenly_stems_year_method.png'
    }],
    format: { label: 'PNG', value: 'png' },
    stage: { label: '阶段1（4张）', value: '1' },
  }, context as any);
  const context2 = {
    fetch: async (url: string, _opts?: any) => {
      try {
        if (url.includes('/ai/cos/credentialv1')) {
          const u = new URL(url);
          const fileName = u.searchParams.get('fileName') || 'part.png';
          const contentType = u.searchParams.get('contentType') || 'image/png';
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                code: 200,
                data: {
                  url: 'https://static.duoduolang.com/AI/image/' + fileName + '?sign=mock',
                  method: 'PUT',
                  key: 'AI/image/' + fileName,
                  bucket: 'mock',
                  region: 'ap-shanghai',
                  extension: 'png',
                  contentType,
                  fileUrl: 'https://static.duoduolang.com/AI/image/' + fileName,
                },
              };
            },
          } as any;
        }
        if (url.includes('static.duoduolang.com') || url.includes('.myqcloud.com')) {
          return {
            ok: true,
            status: 200,
            async json() { return {}; },
            async buffer() { return Buffer.from([]); },
          } as any;
        }
        // image source mock
        if (url.includes('lf3-static.bytednsdoc.com')) {
          const img = await new Jimp(111, 111, 0xff0000ff);
          const buf: Buffer = await img.getBufferAsync(Jimp.MIME_PNG);
          return {
            ok: true,
            status: 200,
            async json() { return {}; },
            async buffer() { return buf; },
          } as any;
        }
        return {
          ok: true,
          status: 200,
          async json() { return {}; },
          async buffer() { return Buffer.from([]); },
        } as any;
      } catch (e) {
        return {
          ok: false,
          status: 500,
          async json() { return {}; },
          async buffer() { return Buffer.from([]); },
        } as any;
      }
    }
  };
  await testField({
    attachments: [{
      name: 'demo.png',
      size: 0,
      type: 'image/png',
      tmp_url: 'https://lf3-static.bytednsdoc.com/obj/eden-cn/abjayvoz/ljhwZthlaukjlkulzlp/jingjing0619/heavenly_stems_year_method.png'
    }],
    format: { label: 'PNG', value: 'png' },
    stage: { label: '阶段2（5张）', value: '2' },
  }, context2 as any);
}

run();
