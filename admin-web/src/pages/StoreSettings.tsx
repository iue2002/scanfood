import React, { useRef, useState, useEffect } from 'react';
import request from '@/api/request';
import { useModal } from '@/components/ModalProvider';
import { Upload, Save, ImageIcon, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { resolveImageUrl } from '@/utils/image-url';
import { smartUpload, fallbackOriginalUpload, type CompressionResult as UploadResult } from '@/utils/image-upload';

interface CompressionResult {
  success: boolean;
  message: string;
  data?: {
    url: string;
    /** 缩略图 URL（新增字段；旧代码不读不影响） */
    thumbnailUrl?: string;
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
  };
  allowOriginalUpload?: boolean;
}

export default function StoreSettings() {
  const { showToast, showConfirm } = useModal();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [storeName, setStoreName] = useState('');
  const [storeAvatar, setStoreAvatar] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [imgBroken, setImgBroken] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState(0);
  const [compressionResult, setCompressionResult] = useState<CompressionResult | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setIsLoading(true);
      const res = await request.get('/store-settings') as any;
      const data = res?.data ?? res;
      if (data) {
        setStoreName(data.store_name || '');
        const avatar = data.store_avatar || '';
        setStoreAvatar(avatar);
        setPreviewUrl(resolveImageUrl(avatar));
        setImgBroken(false);
      }
    } catch (err) {
      console.error('获取店铺设置失败', err);
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const uploadOriginalImage = async (file: File) => {
    setUploading(true);
    try {
      const res = await fallbackOriginalUpload(file, {
        onProgress: (p) => setCompressionProgress(p.percent),
      });
      const url = res?.url || '';
      setStoreAvatar(url);
      setPreviewUrl(resolveImageUrl(url));
      setImgBroken(false);
      showToast('图片上传成功', 'success');
    } catch (err: any) {
      showToast('图片上传失败：' + (err?.message || '未知错误'), 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCompressing(true);
    setCompressionProgress(0);
    setCompressionResult(null);
    setPreviewUrl('');

    try {
      const res: UploadResult = await smartUpload(file, {
        onProgress: (p) => setCompressionProgress(p.percent),
      });

      if (res.success && res.data) {
        setCompressionResult(res as CompressionResult);
        const url = res.data.url;
        setStoreAvatar(url);
        setPreviewUrl(resolveImageUrl(url));
        setImgBroken(false);
        const savedSize = res.data.originalSize - res.data.compressedSize;
        showToast(
          `图片压缩成功！节省 ${formatFileSize(savedSize)}（${res.data.compressionRatio}%）`,
          'success'
        );
      } else {
        setCompressionResult({
          success: false,
          message: res.message || '图片压缩失败',
          allowOriginalUpload: true,
        });
        showConfirm(
          '压缩失败',
          `${res.message || '图片压缩失败'}\n\n图片大小：${formatFileSize(file.size)}\n\n是否继续上传原图？`,
          () => {
            uploadOriginalImage(file);
          },
          () => {
            if (fileInputRef.current) fileInputRef.current.value = '';
          }
        );
      }
    } catch (err: any) {
      setCompressionResult({
        success: false,
        message: err?.message || '图片压缩请求失败',
        allowOriginalUpload: true,
      });
      showConfirm(
        '压缩失败',
        `${err?.message || '图片压缩请求失败'}\n\n图片大小：${formatFileSize(file.size)}\n\n是否继续上传原图？`,
        () => {
          uploadOriginalImage(file);
        },
        () => {
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      );
    } finally {
      setCompressing(false);
    }
  };

  const handleSubmit = async () => {
    if (!storeName.trim()) {
      showToast('请输入店铺名称', 'warning');
      return;
    }

    try {
      setIsSaving(true);
      await request.put('/store-settings', {
        store_name: storeName.trim(),
        store_avatar: storeAvatar,
      });
      showToast('保存成功', 'success');
      // Re-fetch after a short delay to ensure DB commit
      setTimeout(() => fetchSettings(), 300);
    } catch (err: any) {
      showToast('保存失败：' + (err?.message || '未知错误'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-[#0F172A]">店铺设置</h2>
          <p className="text-sm text-[#94A3B8] mt-1">设置您的店铺信息，将在小程序订单列表中显示</p>
        </div>

        <div className="space-y-5">
          {/* 店铺名称 */}
          <div>
            <label className="block text-sm font-medium text-[#334155] mb-2">店铺名称</label>
            <input
              className="w-full h-10 px-3 border border-[#E2E8F0] rounded-lg text-sm text-[#0F172A] outline-none focus:border-[#2563EB] transition-colors"
              placeholder="请输入店铺名称"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
            />
          </div>

          {/* 店铺头像 */}
          <div>
            <label className="block text-sm font-medium text-[#334155] mb-2">店铺头像</label>
            <div className="flex items-center gap-4">
              {/* 头像预览 */}
              <div className="w-20 h-20 rounded-full overflow-hidden bg-[#F1F5F9] border-2 border-[#E2E8F0] flex-shrink-0 relative">
                {previewUrl ? (
                  <>
                    <img
                      className={imgBroken ? 'hidden' : 'w-full h-full object-cover'}
                      src={previewUrl}
                      onError={() => setImgBroken(true)}
                      onLoad={() => setImgBroken(false)}
                    />
                    {imgBroken && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-[#94A3B8]">
                        <ImageIcon size={24} />
                        <span className="text-[11px] mt-1">暂无头像</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-[#94A3B8]">
                    <ImageIcon size={24} />
                    <span className="text-[11px] mt-1">暂无头像</span>
                  </div>
                )}
              </div>

              {/* 上传按钮 */}
              <div>
                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={compressing || uploading}
                  className="flex items-center gap-1.5 px-4 py-2 border border-[#E2E8F0] rounded-lg text-sm text-[#334155] hover:bg-[#F8FAFC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {compressing ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : uploading ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <Upload size={16} />
                  )}
                  {compressing ? '压缩中...' : uploading ? '上传中...' : '选择图片'}
                </button>
              </div>
            </div>

            {/* 压缩进度 */}
            {(compressing || compressionResult) && (
              <div className="mt-3">
                {compressing && (
                  <div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#2563EB] rounded-full transition-all duration-300"
                        style={{ width: `${compressionProgress}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 mt-1">{Math.round(compressionProgress)}%</span>
                  </div>
                )}
                {compressionResult && !compressing && (
                  <div className={`flex items-center gap-2 p-2 rounded-lg ${compressionResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {compressionResult.success ? (
                      <>
                        <CheckCircle size={16} />
                        <span className="text-sm">
                          压缩成功！压缩率 {compressionResult.data?.compressionRatio}%
                          {compressionResult.data && (
                            <span className="text-xs text-gray-500 ml-1">
                              ({formatFileSize(compressionResult.data.originalSize)} → {formatFileSize(compressionResult.data.compressedSize)})
                            </span>
                          )}
                        </span>
                      </>
                    ) : (
                      <>
                        <XCircle size={16} />
                        <span className="text-sm">{compressionResult.message}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 保存按钮 */}
          <div className="flex justify-end pt-4">
            <button
              onClick={handleSubmit}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-6 py-2.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              {isSaving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
