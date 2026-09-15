export function AppLoadingScreen() {
  return (
    <div
      className="fixed inset-0 grid place-items-center bg-[#FAF9F6] text-[#5a5a54]"
      role="status"
      aria-label="正在打开雪泥"
    >
      <div className="flex flex-col items-center gap-4">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#E6E4DF] border-t-[#C2410C]" />
        <span className="text-sm">正在打开雪泥…</span>
      </div>
    </div>
  );
}
