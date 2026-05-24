import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Filter,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Search,
  Shield,
  ShieldOff,
  Trash2,
  UserCircle2,
  X,
} from 'lucide-react'
import request from '@/api/request'
import { useModal } from '@/components/ModalProvider'
import { useAuthStore } from '@/stores/auth'
import { ASSIGNABLE_EMPLOYEE_ROLES, ROLE_LABEL } from '@/rbac/types'
import type { Role } from '@/rbac/types'

interface Employee {
  id: number
  username: string
  role: Role
  nickname: string | null
  avatar_url: string | null
  status: 'active' | 'disabled' | 'deleted'
  token_version: number
  must_change_password: boolean
  created_at: string
  updated_at: string
}

interface PageResp {
  data: Employee[]
  total: number
  page: number
  pageSize: number
}

const ROLE_BADGE: Record<Role, string> = {
  owner: 'bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A]',
  manager: 'bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE]',
  cashier: 'bg-[#D1FAE5] text-[#065F46] border border-[#A7F3D0]',
  waiter: 'bg-[#F1F5F9] text-[#334155] border border-[#E2E8F0]',
  admin: 'bg-purple-100 text-purple-700 border border-purple-300',
  customer: 'bg-gray-100 text-gray-600 border border-gray-300',
}

const STATUS_LABEL = {
  active: { label: '正常', cls: 'bg-[#D1FAE5] text-[#065F46]' },
  disabled: { label: '已禁用', cls: 'bg-[#FEF3C7] text-[#92400E]' },
  deleted: { label: '已删除', cls: 'bg-[#FEE2E2] text-[#991B1B]' },
} as const

export default function EmployeeManage() {
  const me = useAuthStore((s) => s.user)
  const myId = me?.id ?? 0
  const { showToast, showConfirm } = useModal()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(20)
  const [filterRole, setFilterRole] = useState<Role | ''>('')
  const [filterStatus, setFilterStatus] = useState<'' | 'active' | 'disabled'>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [list, setList] = useState<PageResp | null>(null)
  const [loading, setLoading] = useState(false)

  // 弹窗状态
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Employee | null>(null)
  const [tempPwdResult, setTempPwdResult] = useState<{ employee: Employee; tempPassword: string } | null>(null)
  // R21: 排班表占位 Tab
  const [activeTab, setActiveTab] = useState<'employees' | 'shifts'>('employees')

  const fetchList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, any> = { page, pageSize }
      if (filterRole) params.role = filterRole
      if (filterStatus) params.status = filterStatus
      if (searchQuery) params.username = searchQuery
      const res = await request.get<PageResp>('/merchant-ops/employees', { params })
      setList(res as unknown as PageResp)
    } catch (err: any) {
      showToast(err?.message || '加载员工失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filterRole, filterStatus, searchQuery, showToast])

  useEffect(() => {
    fetchList()
  }, [fetchList])

  const totalPages = useMemo(() => (list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1), [list])

  const handleDelete = (employee: Employee) => {
    if (employee.id === myId) {
      showToast('不能删除自己的账号', 'warning')
      return
    }
    showConfirm(
      '确认删除员工',
      `员工"${employee.username}"将被软删除，所有现存登录会立即失效，且不可撤销。是否继续？`,
      async () => {
        try {
          await request.delete(`/merchant-ops/employees/${employee.id}`)
          showToast('员工已删除', 'success')
          fetchList()
        } catch (err: any) {
          showToast(err?.message || err?.data?.msg || '删除失败', 'error')
        }
      },
    )
  }

  const handleResetPassword = (employee: Employee) => {
    if (employee.id === myId) {
      showToast('请使用"修改密码"修改自己的密码', 'warning')
      return
    }
    showConfirm(
      '重置密码',
      `将为员工"${employee.username}"生成一个临时密码，并使其所有登录失效，且需在下次登录后强制改密。是否继续？`,
      async () => {
        try {
          const res = await request.post<{ data: { tempPassword: string } }>(
            `/merchant-ops/employees/${employee.id}/reset-password`,
          )
          const tempPassword = (res as any)?.data?.tempPassword ?? (res as any)?.tempPassword
          if (!tempPassword) throw new Error('未返回临时密码')
          setTempPwdResult({ employee, tempPassword })
          fetchList()
        } catch (err: any) {
          showToast(err?.message || err?.data?.msg || '重置失败', 'error')
        }
      },
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl sm:text-2xl font-semibold text-[#0F172A]">员工管理</h2>
        {activeTab === 'employees' && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors cursor-pointer"
          >
            <Plus size={16} /> 新增员工
          </button>
        )}
      </div>

      {/* Tab 切换：员工 / 排班表占位（R21） */}
      <div className="flex items-center gap-1 border-b border-[#E2E8F0] mb-4">
        <button
          onClick={() => setActiveTab('employees')}
          className={`px-4 py-2 text-sm font-medium cursor-pointer transition-colors border-b-2 -mb-px ${
            activeTab === 'employees'
              ? 'border-[#2563EB] text-[#2563EB]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          员工
        </button>
        <button
          onClick={() => setActiveTab('shifts')}
          className={`px-4 py-2 text-sm font-medium cursor-pointer transition-colors border-b-2 -mb-px ${
            activeTab === 'shifts'
              ? 'border-[#2563EB] text-[#2563EB]'
              : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          排班表
          <span className="ml-1 text-xs text-[#94A3B8]">即将推出</span>
        </button>
      </div>

      {activeTab === 'shifts' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-[#F1F5F9] flex items-center justify-center">
            <CalendarClock className="w-7 h-7 text-[#94A3B8]" />
          </div>
          <h3 className="text-base font-semibold text-[#0F172A] mb-1">排班表（即将推出）</h3>
          <p className="text-sm text-[#94A3B8] max-w-sm mx-auto">
            二期我们会在这里支持周排班、班次模板、跨员工调班、自动统计工时等能力。当前先把员工管理基础打牢。
          </p>
        </div>
      )}

      {activeTab === 'employees' && (
        <>

      {/* 过滤条 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={16} className="text-[#64748B]" />
          <select
            value={filterRole}
            onChange={(e) => { setPage(1); setFilterRole(e.target.value as Role | '') }}
            className="px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <option value="">全部角色</option>
            {ASSIGNABLE_EMPLOYEE_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => { setPage(1); setFilterStatus(e.target.value as any) }}
            className="px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <option value="">全部状态</option>
            <option value="active">正常</option>
            <option value="disabled">已禁用</option>
          </select>
          <div className="relative ml-auto flex-1 min-w-[180px] max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
            <input
              value={searchQuery}
              onChange={(e) => { setPage(1); setSearchQuery(e.target.value) }}
              placeholder="搜索用户名..."
              className="w-full pl-8 pr-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
        </div>
      </div>

      {/* 列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#F8FAFC] text-[#334155]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">用户名</th>
              <th className="text-left px-4 py-3 font-medium">昵称</th>
              <th className="text-left px-4 py-3 font-medium">角色</th>
              <th className="text-left px-4 py-3 font-medium">状态</th>
              <th className="text-left px-4 py-3 font-medium">创建时间</th>
              <th className="text-left px-4 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && !list && (
              <tr><td colSpan={6} className="text-center py-12 text-[#94A3B8]"><Loader2 className="animate-spin inline mr-2" size={16} /> 加载中...</td></tr>
            )}
            {list && list.data.length === 0 && (
              <tr><td colSpan={6} className="text-center py-12 text-[#94A3B8]">暂无员工</td></tr>
            )}
            {list?.data.map((emp) => {
              const isSelf = emp.id === myId
              const status = STATUS_LABEL[emp.status]
              return (
                <tr key={emp.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <UserCircle2 size={18} className="text-[#94A3B8]" />
                      <span className="font-medium text-[#0F172A]">{emp.username}</span>
                      {isSelf && <span className="text-xs px-1.5 py-0.5 rounded bg-[#EFF6FF] text-[#2563EB]">我自己</span>}
                      {emp.must_change_password && <span className="text-xs px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E]">需改密</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#334155]">{emp.nickname || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${ROLE_BADGE[emp.role]}`}>
                      {ROLE_LABEL[emp.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${status.cls}`}>{status.label}</span>
                  </td>
                  <td className="px-4 py-3 text-[#94A3B8] text-xs">{formatDate(emp.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setEditTarget(emp)}
                        className="p-1.5 text-[#2563EB] hover:bg-[#EFF6FF] rounded transition-colors cursor-pointer"
                        title="编辑"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleResetPassword(emp)}
                        disabled={isSelf}
                        title={isSelf ? '请使用"修改自己密码"' : '重置密码'}
                        className={`p-1.5 rounded transition-colors ${isSelf ? 'text-[#CBD5E1] cursor-not-allowed' : 'text-[#F59E0B] hover:bg-amber-50 cursor-pointer'}`}
                      >
                        <KeyRound size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(emp)}
                        disabled={isSelf}
                        title={isSelf ? '不能删除自己' : '删除（软删除）'}
                        className={`p-1.5 rounded transition-colors ${isSelf ? 'text-[#CBD5E1] cursor-not-allowed' : 'text-[#EF4444] hover:bg-red-50 cursor-pointer'}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* 分页 */}
        {list && list.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <div className="text-xs text-[#64748B]">
              共 {list.total} 条，第 {list.page} / {totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => { setPage(1); setPageSize(Number(e.target.value) as 10 | 20 | 50) }}
                className="px-2 py-1 border rounded text-xs bg-white"
              >
                <option value={10}>10/页</option>
                <option value={20}>20/页</option>
                <option value={50}>50/页</option>
              </select>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 border rounded disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 border rounded disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

        </>
      )}

      {/* 创建员工 modal */}
      {createOpen && (
        <EmployeeFormModal
          mode="create"
          onClose={() => setCreateOpen(false)}
          onSuccess={() => { setCreateOpen(false); fetchList() }}
        />
      )}

      {/* 编辑员工 modal */}
      {editTarget && (
        <EmployeeFormModal
          mode="edit"
          target={editTarget}
          isSelf={editTarget.id === myId}
          onClose={() => setEditTarget(null)}
          onSuccess={() => { setEditTarget(null); fetchList() }}
        />
      )}

      {/* 临时密码弹窗 */}
      {tempPwdResult && (
        <TempPasswordModal
          employee={tempPwdResult.employee}
          tempPassword={tempPwdResult.tempPassword}
          onClose={() => setTempPwdResult(null)}
        />
      )}
    </div>
  )
}

function formatDate(s: string): string {
  if (!s) return ''
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// =============================================================================
// 子组件：新增/编辑表单
// =============================================================================
function EmployeeFormModal({
  mode,
  target,
  isSelf,
  onClose,
  onSuccess,
}: {
  mode: 'create' | 'edit'
  target?: Employee
  isSelf?: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const { showToast } = useModal()
  const [username, setUsername] = useState(target?.username ?? '')
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState(target?.nickname ?? '')
  const [role, setRole] = useState<Role>(target?.role ?? 'cashier')
  const [status, setStatus] = useState<'active' | 'disabled'>(
    target?.status === 'disabled' ? 'disabled' : 'active',
  )
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (mode === 'create') {
      if (!username || username.length < 3) {
        showToast('用户名至少 3 个字符', 'warning')
        return
      }
      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        showToast('用户名只能包含字母、数字、下划线', 'warning')
        return
      }
      if (!password || password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
        showToast('密码至少 8 位且需包含字母与数字', 'warning')
        return
      }
    }
    setSubmitting(true)
    try {
      if (mode === 'create') {
        await request.post('/merchant-ops/employees', { username, password, nickname: nickname || undefined, role })
        showToast('员工已创建', 'success')
      } else if (target) {
        await request.patch(`/merchant-ops/employees/${target.id}`, {
          nickname: nickname || undefined,
          role,
          status,
        })
        showToast('员工已更新', 'success')
      }
      onSuccess()
    } catch (err: any) {
      showToast(err?.data?.msg || err?.message || '操作失败', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-[#0F172A]">
            {mode === 'create' ? '新增员工' : `编辑：${target?.username}`}
          </h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full cursor-pointer">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {mode === 'create' && (
            <>
              <div>
                <label className="block text-xs text-[#64748B] mb-1">用户名 *</label>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="3-30 字符，字母/数字/下划线"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#64748B] mb-1">初始密码 *</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 8 位，包含字母与数字"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
                />
              </div>
            </>
          )}
          <div>
            <label className="block text-xs text-[#64748B] mb-1">昵称</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="可选"
              maxLength={50}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
          </div>
          <div>
            <label className="block text-xs text-[#64748B] mb-1">角色 *</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="w-full px-3 py-2 border rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            >
              {ASSIGNABLE_EMPLOYEE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
            {isSelf && role !== target?.role && (
              <p className="text-xs text-[#EF4444] mt-1">⚠️ 不能修改自己的角色（除非新角色权限不低于当前）</p>
            )}
          </div>
          {mode === 'edit' && (
            <div>
              <label className="block text-xs text-[#64748B] mb-1">状态</label>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStatus('active')}
                  disabled={isSelf}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border ${
                    status === 'active' ? 'bg-[#D1FAE5] text-[#065F46] border-[#A7F3D0]' : 'bg-white text-[#64748B] border-gray-200'
                  } ${isSelf ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Shield size={14} /> 正常
                </button>
                <button
                  onClick={() => setStatus('disabled')}
                  disabled={isSelf}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border ${
                    status === 'disabled' ? 'bg-[#FEF3C7] text-[#92400E] border-[#FDE68A]' : 'bg-white text-[#64748B] border-gray-200'
                  } ${isSelf ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <ShieldOff size={14} /> 禁用
                </button>
              </div>
              {isSelf && <p className="text-xs text-[#EF4444] mt-1">⚠️ 不能禁用自己的账号</p>}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-[#F8FAFC] border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-white border border-gray-200 hover:bg-gray-50 cursor-pointer">取消</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm bg-[#2563EB] text-white hover:bg-[#1D4ED8] cursor-pointer disabled:opacity-60"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {mode === 'create' ? '创建' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// 子组件：临时密码展示弹窗
// =============================================================================
function TempPasswordModal({ employee, tempPassword, onClose }: { employee: Employee; tempPassword: string; onClose: () => void }) {
  const { showToast } = useModal()
  const copy = () => {
    navigator.clipboard.writeText(tempPassword)
    showToast('临时密码已复制', 'success')
  }
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-[#0F172A]">已重置 {employee.username} 的密码</h3>
          <p className="text-xs text-[#94A3B8] mt-1">临时密码仅在此弹窗显示一次，关闭后无法找回。请立即抄送给该员工。</p>
        </div>
        <div className="px-5 py-5 bg-[#FFFBEB] border-b border-[#FDE68A]">
          <div className="text-xs text-[#92400E] mb-2">临时密码：</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-2xl font-bold tracking-wider text-[#0F172A] bg-white px-4 py-3 rounded-lg border border-[#FDE68A] select-all">
              {tempPassword}
            </code>
            <button onClick={copy} className="px-3 py-3 bg-[#2563EB] text-white rounded-lg text-sm hover:bg-[#1D4ED8] cursor-pointer">
              复制
            </button>
          </div>
          <p className="text-xs text-[#92400E] mt-3">该员工首次登录后将被强制修改密码。</p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 bg-white">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm bg-[#2563EB] text-white hover:bg-[#1D4ED8] cursor-pointer">
            我已知晓并保存
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * R21.3：员工详情页底部预留挂载点（本期渲染为 null，二期填实）
 * 通过 export 出去，外部组件可在员工详情区域挂上 <EmployeeShiftSection employeeId={id} />
 */
export function EmployeeShiftSection(_props: { employeeId: number }): null {
  return null
}
