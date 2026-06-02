/**
 * OrderItemsBreakdown — 订单明细分组渲染（按加餐轮次）
 *
 * P2-6：抽取 OrderManage 中重复 4 处的「按 add_more_round 分组 + 加餐分隔符 + 逐项渲染」逻辑。
 * 通过 variant 适配桌面表格 / 平板卡片 / 移动卡片 / 详情弹窗的不同视觉密度。
 */
import { Minus, Plus, User } from 'lucide-react'

export interface OrderBreakdownItem {
  id: number
  dish_name: string
  spec_name?: string | null
  quantity: number
  price?: string
  subtotal: string
  added_by_nickname?: string | null
  add_more_round: number
}

type Variant = 'desktop' | 'tablet' | 'mobile' | 'detail'

interface Props {
  items: OrderBreakdownItem[]
  variant: Variant
  /** 详情弹窗专用：是否显示加减数量按钮（仅活跃订单允许） */
  editable?: boolean
  loading?: boolean
  onChangeQty?: (itemId: number, nextQty: number) => void
}

/** 按 add_more_round 升序分组，返回 [{round, items}] */
function groupByRound<T extends { add_more_round: number }>(items: T[]): Array<{ round: number; items: T[] }> {
  const sorted = [...items].sort((a, b) => (a.add_more_round || 0) - (b.add_more_round || 0))
  const groups: Array<{ round: number; items: T[] }> = []
  for (const item of sorted) {
    const round = item.add_more_round || 0
    const last = groups[groups.length - 1]
    if (last && last.round === round) last.items.push(item)
    else groups.push({ round, items: [item] })
  }
  return groups
}

export default function OrderItemsBreakdown({ items, variant, editable, loading, onChangeQty }: Props) {
  if (!items || items.length === 0) {
    if (variant === 'detail') return <p className="text-xs text-[#94A3B8] text-center py-3">暂无菜品</p>
    return <span className="text-[#64748B]">无菜品</span>
  }

  const groups = groupByRound(items)

  const renderRoundLabel = (round: number) => (
    <div className="text-xs font-medium text-[#F59E0B] pt-1.5 mt-1 border-t border-amber-100">
      第{round}次加餐
    </div>
  )

  // 详情弹窗：信息最全（单价、加菜人、可选加减按钮）
  if (variant === 'detail') {
    return (
      <>
        {groups.map((g) => (
          <div key={`round-${g.round}`}>
            {g.round > 0 && renderRoundLabel(g.round)}
            {g.items.map((item) => (
              <div key={item.id} className="flex justify-between items-start mt-2 first:mt-0">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[#0F172A] truncate">
                    {item.dish_name}
                    {item.spec_name && <span className="text-[#94A3B8] font-normal">({item.spec_name})</span>}
                  </div>
                  <div className="text-xs text-[#64748B] mt-0.5">¥{item.price} × {item.quantity}</div>
                  {item.added_by_nickname && (
                    <div className="text-xs text-[#94A3B8] flex items-center gap-1 mt-0.5">
                      <User size={9} /> {item.added_by_nickname}
                    </div>
                  )}
                </div>
                <div className="text-right ml-2">
                  <div className="text-xs font-semibold text-[#0F172A]">¥{item.subtotal}</div>
                  {editable && onChangeQty && (
                    <div className="flex items-center gap-1 mt-1 justify-end">
                      <button
                        onClick={() => onChangeQty(item.id, item.quantity - 1)}
                        className="p-1 text-[#EF4444] hover:bg-red-50 rounded cursor-pointer"
                        disabled={loading}
                      >
                        <Minus size={12} />
                      </button>
                      <button
                        onClick={() => onChangeQty(item.id, item.quantity + 1)}
                        className="p-1 text-[#2563EB] hover:bg-[#EFF6FF] rounded cursor-pointer"
                        disabled={loading}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </>
    )
  }

  // 列表行/卡片：紧凑（菜名 ×数量 + 小计）
  return (
    <>
      {groups.map((g) => (
        <div key={`round-${g.round}`}>
          {g.round > 0 && renderRoundLabel(g.round)}
          {g.items.map((item) => (
            <div key={item.id} className="flex justify-between items-center mt-1 first:mt-0">
              <span className="text-[#0F172A] text-xs min-w-0">
                {item.dish_name}
                {item.spec_name ? `(${item.spec_name})` : ''}
                <span className="text-[#64748B]"> × {item.quantity}</span>
              </span>
              <span className="text-[#64748B] text-xs shrink-0 ml-2">¥{item.subtotal}</span>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
