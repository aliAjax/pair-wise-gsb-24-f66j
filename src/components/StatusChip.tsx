const LABELS: Record<string, Record<string, string>> = {
  artifact: {
    registered: "已登记",
    queued: "排队中",
    bagged: "已装袋",
    sealed: "已封袋",
    transported: "已运走",
  },
  bag: { open: "待封袋", sealed: "已封袋", invalidated: "已失效" },
  app: { draft: "草稿", submitted: "待审批", approved: "已通过" },
  unit: { open: "发掘中", sealed: "已封存" },
};

export function StatusChip({
  kind,
  status,
}: {
  kind: keyof typeof LABELS;
  status: string;
}) {
  return (
    <span className={`chip chip-${status}`}>{LABELS[kind][status] ?? status}</span>
  );
}
