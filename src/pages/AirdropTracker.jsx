export default function AirdropTracker() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-6 pb-24 pt-16 md:px-10 lg:px-16">
        <header className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-emerald-300">
            On-chain campaign overview
          </p>
          <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
            Community Airdrop Progress Tracker
          </h1>
          <p className="mt-4 text-base text-slate-300">
            Follow the live distribution of our community airdrop. This page outlines the total allocation,
            claimed amounts, and activity from recent participants so everyone can stay informed.
          </p>
        </header>

        <main className="space-y-16">
          <section aria-labelledby="stats-heading" className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 id="stats-heading" className="text-xl font-semibold text-white">
                Snapshot
              </h2>
              <p className="text-xs text-slate-400">Updated automatically once the integration is connected.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <article className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-emerald-500/10">
                <p className="text-xs uppercase tracking-wide text-slate-400">Total allocation</p>
                <p className="mt-3 text-2xl font-semibold text-white">—</p>
                <p className="mt-2 text-xs text-slate-400">Populate with the full campaign token pool.</p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-emerald-500/10">
                <p className="text-xs uppercase tracking-wide text-slate-400">Claimed</p>
                <p className="mt-3 text-2xl font-semibold text-white">—</p>
                <p className="mt-2 text-xs text-slate-400">Replace with the cumulative claimed amount.</p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-emerald-500/10">
                <p className="text-xs uppercase tracking-wide text-slate-400">Remaining</p>
                <p className="mt-3 text-2xl font-semibold text-white">—</p>
                <p className="mt-2 text-xs text-slate-400">Shows the still-available allocation.</p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-emerald-500/10">
                <p className="text-xs uppercase tracking-wide text-slate-400">Last updated</p>
                <p className="mt-3 text-2xl font-semibold text-white">—</p>
                <p className="mt-2 text-xs text-slate-400">Timestamp of the latest processed block.</p>
              </article>
            </div>
          </section>

          <section aria-labelledby="progress-heading" className="space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="progress-heading" className="text-xl font-semibold text-white">
                  Campaign progress
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Insert chart or progress visualisation that highlights the claimed vs remaining supply.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-emerald-400 px-5 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-400 hover:text-slate-950"
                >
                  Refresh data
                </button>
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-white/20 px-5 py-2 text-sm font-medium text-white transition hover:bg-white hover:text-slate-950"
                >
                  Clear cache
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-dashed border-white/20 bg-white/5 p-8">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl space-y-4">
                  <p className="text-sm text-slate-300">
                    Highlight the latest block range processed and surface contextual insights. Replace this placeholder copy with
                    live summaries once the airdrop data pipeline is wired up.
                  </p>
                  <ul className="grid gap-3 text-xs text-slate-400 sm:grid-cols-2">
                    <li className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                      <p className="font-semibold text-white">Last scan</p>
                      <p className="mt-1">Blocks — to —</p>
                    </li>
                    <li className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                      <p className="font-semibold text-white">Next refresh</p>
                      <p className="mt-1">Every 60–120 seconds</p>
                    </li>
                    <li className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                      <p className="font-semibold text-white">Token</p>
                      <p className="mt-1">Symbol · decimals</p>
                    </li>
                    <li className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                      <p className="font-semibold text-white">Network</p>
                      <p className="mt-1">Chain name / explorer</p>
                    </li>
                  </ul>
                </div>
                <div className="flex w-full max-w-md flex-col gap-3">
                  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full w-1/2 rounded-full bg-emerald-400" aria-hidden="true" />
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-emerald-200">
                      <p className="text-xs uppercase tracking-wide">Claimed</p>
                      <p className="mt-1 text-lg font-semibold">50%</p>
                    </div>
                    <div className="rounded-2xl bg-slate-800/80 px-4 py-3 text-slate-200">
                      <p className="text-xs uppercase tracking-wide">Remaining</p>
                      <p className="mt-1 text-lg font-semibold">50%</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section aria-labelledby="activity-heading" className="space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="activity-heading" className="text-xl font-semibold text-white">
                  Recent activity
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Showcase the most recent claim transactions once the backend feed is connected.
                </p>
              </div>
              <button
                type="button"
                className="w-full rounded-2xl bg-emerald-500/20 px-4 py-3 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/30 sm:w-auto"
              >
                Download CSV export
              </button>
            </div>

            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black/40">
              <table className="min-w-full divide-y divide-white/5 text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-[0.2em] text-slate-300">
                  <tr>
                    <th scope="col" className="px-6 py-4">Block</th>
                    <th scope="col" className="px-6 py-4">Claimer</th>
                    <th scope="col" className="px-6 py-4">Amount</th>
                    <th scope="col" className="px-6 py-4">Detected</th>
                    <th scope="col" className="px-6 py-4">Explorer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-slate-200">
                  <tr>
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">—</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">wallet…address</td>
                    <td className="px-6 py-4 text-sm font-medium text-white">—</td>
                    <td className="px-6 py-4 text-xs text-slate-400">—</td>
                    <td className="px-6 py-4 text-xs text-emerald-300">Link</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">—</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">wallet…address</td>
                    <td className="px-6 py-4 text-sm font-medium text-white">—</td>
                    <td className="px-6 py-4 text-xs text-slate-400">—</td>
                    <td className="px-6 py-4 text-xs text-emerald-300">Link</td>
                  </tr>
                  <tr>
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">—</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-400">wallet…address</td>
                    <td className="px-6 py-4 text-sm font-medium text-white">—</td>
                    <td className="px-6 py-4 text-xs text-slate-400">—</td>
                    <td className="px-6 py-4 text-xs text-emerald-300">Link</td>
                  </tr>
                </tbody>
              </table>
              <div className="border-t border-white/5 bg-black/30 px-6 py-4 text-xs text-slate-400">
                Showing placeholder rows. Replace with live data when available.
              </div>
            </div>
          </section>

          <section aria-labelledby="faq-heading" className="space-y-6">
            <div className="space-y-2">
              <h2 id="faq-heading" className="text-xl font-semibold text-white">
                Frequently asked questions
              </h2>
              <p className="text-sm text-slate-400">
                Provide guidance for claimants so that newcomers understand how to participate in the distribution.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <article className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h3 className="text-lg font-semibold text-white">How do I verify my eligibility?</h3>
                <p className="mt-2 text-sm text-slate-300">
                  Outline the official eligibility checker, snapshot details, or claim portal used to confirm whether a wallet can
                  participate.
                </p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h3 className="text-lg font-semibold text-white">Which network does the drop use?</h3>
                <p className="mt-2 text-sm text-slate-300">
                  Mention the blockchain, chain ID, and any bridge considerations so users interact with the correct network.
                </p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h3 className="text-lg font-semibold text-white">What if my claim fails?</h3>
                <p className="mt-2 text-sm text-slate-300">
                  Document troubleshooting steps, links to support channels, and how to re-submit transactions safely.
                </p>
              </article>
              <article className="rounded-2xl border border-white/10 bg-white/5 p-6">
                <h3 className="text-lg font-semibold text-white">Can the allocation change?</h3>
                <p className="mt-2 text-sm text-slate-300">
                  Explain whether admins can reclaim tokens or adjust the schedule, and how such changes will be communicated.
                </p>
              </article>
            </div>
          </section>
        </main>

        <footer className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-sm text-slate-400">
          <p className="font-semibold text-white">Need the live integration?</p>
          <p className="mt-2">
            Connect your indexer, supply the token metadata, and swap the placeholder components with your data fetching logic.
            This layout is ready for wiring into a backend or SDK of your choice.
          </p>
          <p className="mt-4 text-xs uppercase tracking-[0.3em] text-emerald-300">Stay transparent · empower the community</p>
        </footer>
      </div>
    </div>
  );
}