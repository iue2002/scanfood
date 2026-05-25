import React, { useRef, useState, useEffect, useMemo } from 'react';
import request from '@/api/request';
import { useModal } from '@/components/ModalProvider';
import {
  Upload,
  Save,
  ImageIcon,
  Loader2,
  CheckCircle,
  XCircle,
  Mail,
  Send,
  Eye,
  EyeOff,
} from 'lucide-react';
import { resolveImageUrl } from '@/utils/image-url';
import { smartUpload, fallbackOriginalUpload, type CompressionResult as UploadResult } from '@/utils/image-upload';
import { useAuthStore } from '@/stores/auth';

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

interface SmtpConfig {
  mode: 'platform' | 'custom';
  host: string;
  port: number | '';
  user: string;
  pass: string; // 用户输入的明文（提交时加密；空表示沿用旧密码）
  from: string;
  secure: boolean;
  has_password: boolean;
}

const DEFAULT_SMTP: SmtpConfig = {
  mode: 'platform',
  host: '',
  port: '',
  user: '',
  pass: '',
  from: '',
  secure: true,
  has_password: false,
};

export default function StoreSettings() {
  const { showToast, showConfirm } = useModal();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const role = useAuthStore((s) => s.user?.role);
  // SMTP 配置仅 owner / manager / admin 可见可写
  const canManageSmtp = useMemo(
    () => role === 'owner' || role === 'manager' || role === 'admin',
    [role],
  );

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

  // SMTP 配置
  const [smtp, setSmtp] = useState<SmtpConfig>(DEFAULT_SMTP);
  const [smtpLoaded, setSmtpLoaded] = useState(false);
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [testEmail, setTestEmail] = useState('');

  useEffect(() => {
    fetchSettings();
    if (canManageSmtp) {
      fetchSmtpConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageSmtp]);

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

  const fetchSmtpConfig = async () => {
    try {
      const res: any = await request.get('/store-settings/smtp');
      const data = res?.data ?? res;
      if (data) {
        setSmtp({
          mode: data.mode || 'platform',
          host: data.host || '',
          port: data.port ?? '',
          user: data.user || '',
          pass: '', // 永远不返回明文
          from: data.from || '',
          secure: data.secure !== false,
          has_password: !!data.has_password,
        });
      }
      setSmtpLoaded(true);
    } catch (err: any) {
      // 普通员工没权限读 → 静默
      if (err?.response?.status !== 403) {
        console.error('获取 SMTP 配置失败', err);
      }
      setSmtpLoaded(true);
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

  // ============ SMTP 配置 ============

  const handleSaveSmtp = async () => {
    // 校验
    if (smtp.mode === 'custom') {
      if (!smtp.host.trim()) return showToast('请填写 SMTP 服务器地址', 'warning');
      if (!smtp.port || smtp.port < 1 || smtp.port > 65535) return showToast('端口范围 1~65535', 'warning');
      if (!smtp.user.trim()) return showToast('请填写 SMTP 用户名', 'warning');
      if (!smtp.from.trim()) return showToast('请填写发件邮箱', 'warning');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(smtp.from)) return showToast('发件邮箱格式不合法', 'warning');
      if (!smtp.has_password && !smtp.pass) return showToast('首次配置请填写密码 / 授权码', 'warning');
    }

    setSavingSmtp(true);
    try {
      const payload: any = {
        mode: smtp.mode,
        secure: smtp.secure,
      };
      if (smtp.mode === 'custom') {
        payload.host = smtp.host.trim();
        payload.port = Number(smtp.port);
        payload.user = smtp.user.trim();
        payload.from = smtp.from.trim();
        if (smtp.pass) payload.pass = smtp.pass;
      }

      const res: any = await request.put('/store-settings/smtp', payload);
      const data = res?.data ?? res;
      if (data) {
        setSmtp({
          mode: data.mode || 'platform',
          host: data.host || '',
          port: data.port ?? '',
          user: data.user || '',
          pass: '',
          from: data.from || '',
          secure: data.secure !== false,
          has_password: !!data.has_password,
        });
      }
      showToast('SMTP 配置已保存', 'success');
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '保存失败';
      showToast('保存失败：' + msg, 'error');
    } finally {
      setSavingSmtp(false);
    }
  };

  const handleTestSmtp = async () => {
    if (!testEmail) return showToast('请填写测试收件邮箱', 'warning');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testEmail)) return showToast('收件邮箱格式不合法', 'warning');
    setTestingSmtp(true);
    try {
      const res: any = await request.post('/notif/email/test', { to: testEmail, mode: smtp.mode });
      if (res?.success !== false) {
        showToast(res?.message || '测试邮件已发送，请检查收件箱', 'success');
      } else {
        showToast(res?.message || '测试邮件发送失败', 'error');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || '测试邮件发送失败';
      showToast(msg, 'error');
    } finally {
      setTestingSmtp(false);
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
    <div className="max-w-2xl space-y-6">
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

      {/* 邮件 SMTP 配置（owner / manager 可见） */}
      {canManageSmtp && smtpLoaded && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] flex items-center justify-center">
              <Mail className="w-5 h-5 text-[#2563EB]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#0F172A]">邮件通知 SMTP</h2>
              <p className="text-xs text-[#94A3B8] mt-0.5">配置发件箱，新订单可发送邮件兜底通知</p>
            </div>
          </div>

          {/* 模式切换 */}
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => setSmtp((s) => ({ ...s, mode: 'platform' }))}
              className={`flex-1 px-3 py-3 rounded-lg border-2 text-left transition-colors ${
                smtp.mode === 'platform' ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E2E8F0] bg-white hover:border-[#CBD5E1]'
              }`}
            >
              <div className={`text-sm font-medium ${smtp.mode === 'platform' ? 'text-[#2563EB]' : 'text-[#0F172A]'}`}>
                使用平台默认
              </div>
              <div className="text-xs text-[#94A3B8] mt-1">由系统统一发件，省心</div>
            </button>
            <button
              onClick={() => setSmtp((s) => ({ ...s, mode: 'custom' }))}
              className={`flex-1 px-3 py-3 rounded-lg border-2 text-left transition-colors ${
                smtp.mode === 'custom' ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E2E8F0] bg-white hover:border-[#CBD5E1]'
              }`}
            >
              <div className={`text-sm font-medium ${smtp.mode === 'custom' ? 'text-[#2563EB]' : 'text-[#0F172A]'}`}>
                自定义 SMTP
              </div>
              <div className="text-xs text-[#94A3B8] mt-1">用自己的 QQ / 阿里云 / 163 邮箱</div>
            </button>
          </div>

          {smtp.mode === 'custom' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#475569] mb-1">SMTP 服务器</label>
                  <input
                    type="text"
                    value={smtp.host}
                    onChange={(e) => setSmtp((s) => ({ ...s, host: e.target.value }))}
                    placeholder="smtp.qq.com"
                    className="w-full h-10 px-3 border border-[#E2E8F0] rounded-lg text-sm outline-none focus:border-[#2563EB]"
                    maxLength={255}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#475569] mb-1">端口</label>
                  <input
                    type="number"
                    value={smtp.port}
                    onChange={(e) => setSmtp((s) => ({ ...s, port: e.target.value === '' ? '' : Number(e.target.value) }))}
                    placeholder="465"
                    className="w-full h-10 px-3 border border-[#E2E8F0] rounded-lg text-sm outline-none focus:border-[#2563EB]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">用户名（账号）</label>
                <input
                  type="text"
                  value={smtp.user}
                  onChange={(e) => setSmtp((s) => ({ ...s, user: e.target.value }))}
                  placeholder="example@qq.com"
                  className="w-full h-10 px-3 border border-[#E2E8F0] rounded-lg text-sm outline-none focus:border-[#2563EB]"
                  maxLength={255}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">
                  密码 / 授权码
                  {smtp.has_password && (
                    <span className="ml-2 text-[#10B981] inline-flex items-center gap-1">
                      <CheckCircle size={12} /> 已设置（留空保持不变）
                    </span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={smtp.pass}
                    onChange={(e) => setSmtp((s) => ({ ...s, pass: e.target.value }))}
                    placeholder={smtp.has_password ? '••••••••（如需更换请输入新值）' : 'QQ 邮箱授权码 / SMTP 密码'}
                    className="w-full h-10 pl-3 pr-10 border border-[#E2E8F0] rounded-lg text-sm outline-none focus:border-[#2563EB]"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#94A3B8] hover:text-[#475569]"
                  >
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="text-xs text-[#94A3B8] mt-1">密码会用 AES-256-GCM 加密存储，不会以明文保留</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#475569] mb-1">发件人邮箱</label>
                <input
                  type="email"
                  value={smtp.from}
                  onChange={(e) => setSmtp((s) => ({ ...s, from: e.target.value }))}
                  placeholder="example@qq.com"
                  className="w-full h-10 px-3 border border-[#E2E8F0] rounded-lg text-sm outline-none focus:border-[#2563EB]"
                  maxLength={255}
                />
                <p className="text-xs text-[#94A3B8] mt-1">
                  通常须与上面的「用户名」一致；QQ / 163 / 阿里云不允许伪装发件人
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smtp.secure}
                  onChange={(e) => setSmtp((s) => ({ ...s, secure: e.target.checked }))}
                  className="w-4 h-4 rounded border-[#CBD5E1] text-[#2563EB] focus:ring-[#2563EB]"
                />
                <span className="text-sm text-[#475569]">启用 SSL/TLS（端口 465 一般勾选；587 通常不勾）</span>
              </label>

              <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#64748B]">
                <div className="font-medium text-[#475569] mb-1">常见配置参考</div>
                <div>QQ 邮箱：smtp.qq.com / 465 (SSL) — 密码用「授权码」（QQ 邮箱设置 → 账户 → 开启 SMTP）</div>
                <div>163 邮箱：smtp.163.com / 465 (SSL) — 密码用「授权码」</div>
                <div>阿里云邮件推送：smtpdm.aliyun.com / 465 (SSL) — 用控制台生成的 SMTP 密码</div>
              </div>
            </div>
          )}

          {smtp.mode === 'platform' && (
            <div className="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-[#64748B]">
              使用平台默认发件箱（由系统管理员在 .env 中配置）。如未配置则邮件通知不可用，建议切换为「自定义」并填写自己的邮箱。
            </div>
          )}

          <div className="flex gap-2 mt-5">
            <button
              onClick={handleSaveSmtp}
              disabled={savingSmtp}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-sm font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {savingSmtp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存 SMTP 配置
            </button>
          </div>

          {/* 测试发送区 */}
          <div className="mt-5 pt-5 border-t border-[#E2E8F0]">
            <label className="block text-xs font-medium text-[#475569] mb-1">发测试邮件验证</label>
            <div className="flex gap-2">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="收件邮箱（可填自己的）"
                className="flex-1 h-10 px-3 border border-[#E2E8F0] rounded-lg text-sm outline-none focus:border-[#2563EB]"
                maxLength={255}
              />
              <button
                onClick={handleTestSmtp}
                disabled={!testEmail || testingSmtp}
                className="inline-flex items-center gap-1.5 px-4 h-10 rounded-lg bg-[#10B981] text-white text-sm font-medium hover:bg-[#059669] disabled:opacity-50"
              >
                {testingSmtp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                发送测试
              </button>
            </div>
            <p className="text-xs text-[#94A3B8] mt-1">建议先保存配置再测试，确保以最新设置发送</p>
          </div>
        </div>
      )}
    </div>
  );
}
