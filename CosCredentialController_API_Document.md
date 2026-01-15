# COS文件上传凭证接口文档

## 接口概述

**接口名称**: 获取COS上传凭证 (v1版本)
**接口路径**: `GET /ai/cos/credentialv1`
**功能描述**: 获取腾讯云COS文件上传的预签名URL和相关凭证信息，支持智能文件名生成和目录分类存储

## 请求信息

### 请求方式
```
GET /ai/cos/credentialv1
```

### 请求参数

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `fileName` | String | 否 | 自动生成 | 文件名。如果不提供，会自动生成唯一文件名 |
| `contentType` | String | 否 | 空 | MIME类型，如 `video/mp4`, `image/jpeg` 等 |
| `fileExtension` | String | 否 | mp4 | 文件扩展名，不包含点号。如 `mp4`, `jpg`, `png` |

### 参数优先级
1. **fileExtension** > contentType：如果提供了 fileExtension，直接使用
2. **contentType**：根据MIME类型智能推断扩展名
3. **默认值**：使用 mp4 作为默认扩展名

## 响应信息

### 成功响应

```json
{
  "code": 200,
  "msg": "获取凭证成功",
  "data": {
    "url": "https://bucket-name.cos.region.myqcloud.com/AI/video/video_1704067200000_abc12345.mp4?signature=...",
    "method": "PUT",
    "key": "AI/video/video_1704067200000_abc12345.mp4",
    "bucket": "your-bucket-name",
    "region": "ap-shanghai",
    "extension": "mp4",
    "contentType": "video/mp4",
    "fileUrl": "https://cdn-domain.com/AI/video/video_1704067200000_abc12345.mp4"
  }
}
```

### 响应字段说明

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `url` | String | 预签名上传URL，有效期1小时 |
| `method` | String | 请求方法，固定为 "PUT" |
| `key` | String | COS对象键（存储路径） |
| `bucket` | String | 存储桶名称 |
| `region` | String | 地域信息，如 "ap-shanghai" |
| `extension` | String | 文件扩展名 |
| `contentType` | String | MIME类型 |
| `fileUrl` | String | 文件访问URL（上传成功后可用的URL） |

### 失败响应

```json
{
  "code": 500,
  "msg": "获取凭证失败：错误信息",
  "data": null
}
```

## 文件上传流程

### 1. 获取上传凭证
```javascript
// 示例：获取视频上传凭证
const response = await uni.request({
  url: 'https://your-domain.com/ai/cos/credentialv1',
  method: 'GET',
  data: {
    contentType: 'video/mp4',
    fileExtension: 'mp4'
  }
});
```

### 2. 使用预签名URL上传文件
```javascript
const credential = response.data.data;

// 使用 uni.uploadFile 上传（推荐）
const uploadResult = await uni.uploadFile({
  url: credential.url,
  filePath: localFilePath,
  name: 'file',
  header: {
    'Content-Type': credential.contentType || 'video/mp4'
  }
});

// 或使用 uni.request 上传
const uploadResult = await uni.request({
  url: credential.url,
  method: 'PUT',
  data: fileData,
  header: {
    'Content-Type': credential.contentType || 'video/mp4'
  }
});
```

### 3. 获取最终文件URL
```javascript
// 上传成功后，credential.fileUrl 即为可访问的文件URL
const finalFileUrl = credential.fileUrl;
```

## 存储目录结构

接口会根据文件类型自动选择存储目录：

| 文件类型 | 目录路径 | 支持的扩展名 |
|----------|----------|--------------|
| 图片 | `AI/image/` | jpg, jpeg, png, gif, bmp, webp, svg, ico |
| 视频 | `AI/video/` | mp4, mov, avi, mkv, webm, flv, wmv, m4v |
| 音频 | `AI/audio/` | mp3, wav, flac, aac, ogg, m4a, wma |
| 文档 | `AI/document/` | pdf, doc, docx, xls, xlsx, ppt, pptx, txt, md |
| 其他 | `AI/other/` | 其他所有文件类型 |

## 文件命名规则

### 自动生成文件名
如果不提供 `fileName` 参数，系统会自动生成唯一文件名：

```
{prefix}_{timestamp}_{uuid}.{extension}
```

**示例**:
- `video_1704067200000_abc12345.mp4`
- `image_1704067200000_def67890.jpg`

### 自定义文件名
如果提供 `fileName` 参数：
- 系统会自动确保文件名有正确的扩展名
- 如果扩展名不匹配，会自动替换

## Content-Type 映射表

| Content-Type | 扩展名 |
|--------------|--------|
| `video/mp4` | mp4 |
| `video/mov` | mov |
| `image/jpeg` | jpg |
| `image/png` | png |
| `image/gif` | gif |
| `image/webp` | webp |
| `audio/mpeg` | mp3 |
| `audio/wav` | wav |
| `application/pdf` | pdf |
| `application/msword` | docx |
| `application/vnd.ms-excel` | xlsx |

## 错误处理

### 常见错误码
- `400`: 参数错误
- `500`: 服务器内部错误

### 错误信息示例
- "获取凭证失败：COS服务不可用"
- "获取凭证失败：存储桶不存在"
- "获取凭证失败：权限不足"

## 注意事项

1. **凭证有效期**: 预签名URL有效期为1小时，请在获取后尽快使用
2. **文件大小限制**: COS有单文件大小限制，请根据需要调整分片上传策略
3. **并发上传**: 支持多文件并发上传，每个文件需要单独获取凭证
4. **网络超时**: 建议设置合理的请求超时时间
5. **错误重试**: 上传失败时可重新获取凭证重试

## 示例代码

### JavaScript (uni-app)

```javascript
// 获取视频上传凭证
async function getUploadCredential(contentType = 'video/mp4', fileExtension = 'mp4') {
  try {
    const response = await uni.request({
      url: `${config.baseUrl}/ai/cos/credentialv1`,
      method: 'GET',
      data: {
        contentType,
        fileExtension
      }
    });

    if (response.data.code === 200) {
      return response.data.data;
    } else {
      throw new Error(response.data.msg);
    }
  } catch (error) {
    console.error('获取上传凭证失败:', error);
    throw error;
  }
}

// 上传文件
async function uploadFile(localFilePath, contentType = 'video/mp4') {
  try {
    // 1. 获取上传凭证
    const credential = await getUploadCredential(contentType);

    // 2. 上传文件
    const uploadResult = await uni.uploadFile({
      url: credential.url,
      filePath: localFilePath,
      name: 'file',
      header: {
        'Content-Type': contentType
      }
    });

    // 3. 返回文件访问URL
    if (uploadResult.statusCode === 200) {
      return credential.fileUrl;
    } else {
      throw new Error('上传失败');
    }
  } catch (error) {
    console.error('文件上传失败:', error);
    throw error;
  }
}
```

---

**文档版本**: v1.0
**最后更新**: 2025-01-09
**维护人员**: AI助手
