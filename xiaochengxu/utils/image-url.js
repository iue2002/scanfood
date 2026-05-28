const { SERVER_URL } = require('../config');

/**
 * 把后端返回的相对图片 URL 拼接成完整 URL
 * - 过滤临时文件路径
 * - 已是完整 http(s) URL 的直接返回
 */
function resolveImageUrl(relativeUrl) {
  if (!relativeUrl) return '';
  if (relativeUrl.startsWith('http')) return relativeUrl;
  if (relativeUrl.includes('__tmp__') || relativeUrl.includes('tmp/')) return '';
  return SERVER_URL + (relativeUrl.startsWith('/') ? '' : '/') + relativeUrl;
}

/**
 * 从主图 URL 推导出缩略图 URL
 * 后端 upload/compress 会同时生成 xxx.webp 和 xxx_thumb.webp
 */
function toThumbnailUrl(imageUrl) {
  if (!imageUrl) return '';
  return imageUrl.replace(/\.webp$/, '_thumb.webp');
}

module.exports = { resolveImageUrl, toThumbnailUrl };
