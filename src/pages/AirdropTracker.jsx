import { useMemo } from "react";

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const totalAllocation = 12_500_000;
const claimedAllocation = 6_875_430;
const lastUpdated = new Date("2024-05-23T18:42:00Z");

const activityLog = [
  {
    block: "18,204,530",
    wallet: "0x12c4…0ff2",
    amount: 1240,
    detected: "2 minutes ago",
    explorerUrl: "https://etherscan.io/tx/0x12c40ff2",
  },
  {
    block: "18,204,488",
    wallet: "0x9bd8…cd30",
    amount: 980,
    detected: "7 minutes ago",
    explorerUrl: "https://etherscan.io/tx/0x9bd8cd30",
  },
  {
    block: "18,204,462",
    wallet: "0xa421…15e9",
    amount: 1760,
    detected: "14 minutes ago",
    explorerUrl: "https://etherscan.io/tx/0xa42115e9",
  },
  {
    block: "18,204,436",
    wallet: "0xf09a…d742",
    amount: 550,
    detected: "19 minutes ago",
    explorerUrl: "https://etherscan.io/tx/0xf09ad742",
  },
];

const faqs = [
  {
    question: "How do I verify my eligibility?",
    answer:
      "Visit the official claim portal and connect your wallet. The eligibility checker evaluates your on-chain activity based on the snapshot height and returns a precise allocation before any transaction is signed.",
  },
  {
    question: "Which network does the drop use?",
    answer:
      "The distribution is settled on Ethereum Mainnet. Always confirm the RPC URL, chain ID (1), and the contract hash published in our documentation before authorising transactions.",
  },
  {
    question: "What if my claim fails?",
    answer:
      "Keep the failed transaction hash, then retry after refreshing your proof. Gas spikes or outdated Merkle proofs are the most common causes—updating the proof or waiting for lower fees typically resolves the issue.",
  },
  {
    question: "Can the allocation change?",
    answer:
      "The circulating pool is fixed, but unclaimed tokens after the sunset date are redirected to the community treasury. Any governance decision that amends this rule will be announced two weeks in advance.",
  },
];

export default function AirdropTracker() {
  const remainingAllocation = totalAllocation - claimedAllocation;

  const stats = useMemo(
    () => [
      {
        label: "Total allocation",
        value: `${numberFormatter.format(totalAllocation)} DROP`,
        helper: "Complete community pool available throughout the campaign phases.",
      },
      {
        label: "Claimed",
        value: `${numberFormatter.format(claimedAllocation)} DROP`,
        helper: "Tokens that have already been routed to verified recipients.",
      },
      {
        label: "Remaining",
        value: `${numberFormatter.format(remainingAllocation)} DROP`,
        helper: "Balance still ready to be claimed before the closing date.",
      },
      {
        label: "Last updated",
        value: dateFormatter.format(lastUpdated),
        helper: "Timestamp of the latest indexed block range.",
      },
    ],
    [remainingAllocation]
  );

  const claimedPercentage = Math.round((claimedAllocation / totalAllocation) * 100);
  const remainingPercentage = 100 - claimedPercentage;

  const progressSummary = useMemo(
    () => [
      { label: "Last scan", value: "Blocks 18,204,220 – 18,204,520" },
      { label: "Next refresh", value: "Every 90 seconds" },
      { label: "Token", value: "DROP · 18 decimals" },
      { label: "Network", value: "Ethereum Mainnet" },
    ],
    []
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 pb-24 pt-12 sm:px-6 md:px-10 lg:px-16">
        <header className="mx-auto flex max-w-3xl flex-col gap-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.4em] text-emerald-300">
            On-chain campaign overview
          </p>
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl md:text-5xl">
            Community Airdrop Progress Tracker
          </h1>
          <p className="text-sm text-slate-300 sm:text-base">
            Monitor the state of the community distribution in real time. Once the live indexer is wired up this
            dashboard reflects the verified supply, recent claimants, and operational updates in one place.
          </p>
        </header>

        <main className="space-y-16">
          <section aria-labelledby="stats-heading" className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 id="stats-heading" className="text-lg font-semibold text-white sm:text-xl">
                Snapshot
              </h2>
              <p className="text-xs text-slate-400 sm:text-sm">
                Updated automatically when the Supabase indexer confirms a new block range.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {stats.map((stat) => (
                <article
                  key={stat.label}
                  className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-emerald-500/10 backdrop-blur"
                >
                  <p className="text-[0.7rem] uppercase tracking-[0.3em] text-slate-400">{stat.label}</p>
                  <p className="mt-3 text-2xl font-semibold text-white sm:text-3xl">{stat.value}</p>
                  <p className="mt-2 text-xs text-slate-400 sm:text-sm">{stat.helper}</p>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="progress-heading" className="space-y-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2 text-left">
                <h2 id="progress-heading" className="text-lg font-semibold text-white sm:text-xl">
                  Campaign progress
                </h2>
                <p className="text-sm text-slate-400">
                  The progress indicator compares the claimed supply versus the remaining allocation based on the latest
                  indexed Merkle root.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-emerald-400 px-5 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-400 hover:text-slate-950"
                >
                  Refresh data
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2 text-sm font-medium text-white transition hover:bg-white hover:text-slate-950"
                >
                  Clear cache
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-dashed border-white/20 bg-white/5 p-6 sm:p-8">
              <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
                <div className="max-w-2xl space-y-6">
                  <p className="text-sm text-slate-300">
                    Claims are processed in batches every few minutes. Once the live service is connected this panel will
                    display streaming analytics sourced directly from your preferred RPC provider or data warehouse.
                  </p>
                  <dl className="grid gap-3 text-xs text-slate-300 sm:grid-cols-2">
                    {progressSummary.map((item) => (
                      <div
                        key={item.label}
                        className="rounded-xl border border-white/10 bg-black/30 px-4 py-3"
                      >
                        <dt className="font-semibold text-white">{item.label}</dt>
                        <dd className="mt-1 text-sm text-slate-300">{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="flex w-full max-w-md flex-col gap-4">
                  <span className="sr-only">{claimedPercentage}% of the supply has been claimed.</span>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all"
                      style={{ width: `${claimedPercentage}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                    <span>{claimedPercentage}% claimed</span>
                    <span>{remainingPercentage}% remaining</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-emerald-100">
                      <p className="text-[0.65rem] uppercase tracking-[0.2em]">Claimed</p>
                      <p className="mt-1 text-lg font-semibold text-emerald-200">
                        {numberFormatter.format(claimedAllocation)} DROP
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-slate-200">
                      <p className="text-[0.65rem] uppercase tracking-[0.2em]">Remaining</p>
                      <p className="mt-1 text-lg font-semibold">
                        {numberFormatter.format(remainingAllocation)} DROP
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section aria-labelledby="activity-heading" className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-2">
                <h2 id="activity-heading" className="text-lg font-semibold text-white sm:text-xl">
                  Recent activity
                </h2>
                <p className="text-sm text-slate-400">
                  Live rows appear here once transaction ingestion is enabled. Export a CSV or integrate the Supabase API
                  to stream it into your own dashboard.
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
              <div className="hidden md:block">
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
                    {activityLog.map((entry) => (
                      <tr key={`${entry.block}-${entry.wallet}`}>
                        <td className="px-6 py-4 font-mono text-xs text-slate-400">{entry.block}</td>
                        <td className="px-6 py-4 font-mono text-xs text-slate-300">{entry.wallet}</td>
                        <td className="px-6 py-4 text-sm font-semibold text-white">
                          {numberFormatter.format(entry.amount)} DROP
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-400">{entry.detected}</td>
                        <td className="px-6 py-4 text-xs text-emerald-300">
                          <a href={entry.explorerUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                            View
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-white/5 md:hidden" role="list">
                {activityLog.map((entry) => (
                  <article key={`${entry.block}-${entry.wallet}`} className="space-y-3 px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <p className="font-mono text-xs text-slate-400">Block {entry.block}</p>
                      <span className="text-xs text-slate-400">{entry.detected}</span>
                    </div>
                    <p className="font-mono text-sm text-slate-200">{entry.wallet}</p>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">
                        {numberFormatter.format(entry.amount)} DROP
                      </span>
                      <a
                        href={entry.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-emerald-300 underline-offset-2 hover:underline"
                      >
                        View explorer
                      </a>
                    </div>
                  </article>
                ))}
              </div>

              <div className="border-t border-white/5 bg-black/30 px-6 py-4 text-xs text-slate-400">
                Showing synced sample rows. Replace with your indexer feed to activate live tracking.
              </div>
            </div>
          </section>

          <section aria-labelledby="faq-heading" className="space-y-6">
            <div className="space-y-2">
              <h2 id="faq-heading" className="text-lg font-semibold text-white sm:text-xl">
                Frequently asked questions
              </h2>
              <p className="text-sm text-slate-400">
                Quick answers to the most common community questions. Update the copy as your distribution evolves.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {faqs.map((item) => (
                <article key={item.question} className="rounded-2xl border border-white/10 bg-white/5 p-6">
                  <h3 className="text-lg font-semibold text-white">{item.question}</h3>
                  <p className="mt-2 text-sm text-slate-300">{item.answer}</p>
                </article>
              ))}
            </div>
          </section>
        </main>

        <footer className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-sm text-slate-400">
          <p className="text-base font-semibold text-white">Need the live integration?</p>
          <p className="mt-2">
            Connect your indexer, provide the token metadata, and replace the mocked arrays with your API call. The layout
            already accommodates large screens while stacking gracefully on smaller devices.
          </p>
          <p className="mt-4 text-xs uppercase tracking-[0.3em] text-emerald-300">Stay transparent · empower the community</p>
        </footer>
      </div>
    </div>
  );
}
