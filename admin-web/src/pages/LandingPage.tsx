import { useNavigate } from 'react-router-dom'
import { UtensilsCrossed, ArrowRight, Code2, GraduationCap, Server } from 'lucide-react'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[#EFF6FF] to-[#F1F5F9]">
      {/* 主内容区 */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {/* Logo + 标题 */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-[#2563EB] rounded-xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <UtensilsCrossed size={32} className="text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#0F172A] mb-2">艾力的项目</h1>
          <p className="text-sm text-[#64748B] max-w-md mx-auto">
            一个个人项目展示网站，课程设计、毕业设计落地，为了模拟真实业务
          </p>
        </div>

        {/* 项目简介卡片 */}
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-6 sm:p-8 mb-8">
          <h2 className="text-base font-semibold text-[#0F172A] mb-4">项目介绍</h2>
          <p className="text-sm text-[#64748B] leading-relaxed mb-6">
            本项目是一个扫码点餐系统的完整实现，涵盖微信小程序顾客端、商家管理后台和 NestJS 后端 API。
            包含桌台管理、订单处理、菜品管理、员工权限、打印方案、数据统计等完整功能模块。
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-[#F8FAFC]">
              <Code2 size={18} className="text-[#2563EB] mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-[#0F172A]">技术栈</p>
                <p className="text-xs text-[#94A3B8] mt-0.5">React + NestJS + MySQL</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-[#F8FAFC]">
              <GraduationCap size={18} className="text-[#2563EB] mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-[#0F172A]">用途</p>
                <p className="text-xs text-[#94A3B8] mt-0.5">课程设计 / 毕业设计</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-[#F8FAFC]">
              <Server size={18} className="text-[#2563EB] mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-[#0F172A]">部署</p>
                <p className="text-xs text-[#94A3B8] mt-0.5">阿里云 ECS</p>
              </div>
            </div>
          </div>
        </div>

        {/* 进入后台按钮 */}
        <button
          onClick={() => navigate('/login')}
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl text-sm font-medium transition-colors shadow-sm cursor-pointer"
        >
          进入后台
          <ArrowRight size={16} />
        </button>
      </div>

      {/* 底部备案信息 */}
      <div className="py-4 text-center">
        <a
          href="https://beian.miit.gov.cn/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-[#94A3B8] hover:text-[#2563EB] transition-colors"
        >
          新ICP备2026004458号-1
        </a>
      </div>
    </div>
  )
}
