interface BadgeProps {
  count: number
  /** 超过此数显示 N+，默认 99 */
  max?: number
  /** 是否使用紧凑小红点（小于等于 0 时不显示） */
  dot?: boolean
}

/**
 * 通用红点徽标：
 * - count > 0 显示数字（>= max+1 显示 max+）
 * - dot=true 时不管 count 多少都用一个小红点
 * - 0 时返回 null（不渲染）
 */
export default function Badge({ count, max = 99, dot = false }: BadgeProps) {
  if (count <= 0) return null
  if (dot) {
    return (
      <span className="inline-block w-2 h-2 rounded-full bg-red-500 ring-2 ring-white" />
    )
  }
  const display = count > max ? `${max}+` : String(count)
  return (
    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none ring-2 ring-white">
      {display}
    </span>
  )
}
