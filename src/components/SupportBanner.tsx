const TRADE_LINK = 'https://steamcommunity.com/tradeoffer/new/?partner=135963670&token=IS6KDROD';

export function SupportBanner() {
  return (
    <section className="mb-5 overflow-hidden rounded-3xl border border-amber-300/40 bg-gradient-to-br from-amber-400 via-orange-500 to-rose-600 p-[1px] shadow-[0_0_45px_rgba(245,158,11,0.24)]">
      <div className="rounded-3xl bg-slate-950/92 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.32em] text-amber-200">Support the free trainer</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Donate unwanted CS2 skins if this helped you train.
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-200 sm:text-base">
              The site is free to host and use. If you enjoy it, send any skins you do not want anymore through my Steam trade link so I can keep improving the trainer.
            </p>
          </div>
          <a
            className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-amber-300 px-6 py-4 text-center text-lg font-black text-slate-950 shadow-[0_0_35px_rgba(251,191,36,0.35)] transition hover:bg-amber-200 active:scale-[0.98]"
            href={TRADE_LINK}
            target="_blank"
            rel="noreferrer"
          >
            Donate CS2 skins
          </a>
        </div>
      </div>
    </section>
  );
}
