// Fixture 4: evidence-backed brief with citations, long headings, a chart and
// a source list. Every source is fictional, labelled as such, and has no URL.

import { BRIEF_FIELDS } from '../brief'
import type { BriefSnapshot, Citation } from '../model'
import { BRIGHTWATER } from './brands'
import { date, fieldMap, provided, run, text } from './builders'

const CITATIONS: Citation[] = [
  { id: 'src-1', title: 'Subscription cohort summary, Q2 2026 (sample source)', publisher: 'Northbridge Reader Panel — fictional', date: '2026-07', locator: 'Table 3', fictional: true },
  { id: 'src-2', title: 'Exit-survey responses from cancelled members (sample source)', publisher: 'Lantern & Quire Books — fictional', date: '2026-08', locator: 'Question 4', fictional: true },
  { id: 'src-3', title: 'Onboarding email test, two-arm comparison (sample source)', publisher: 'Brightwater Research Studio — fictional', date: '2026-09-14', locator: 'Results, para. 2', fictional: true },
  { id: 'src-4', title: 'Independent bookshop operating benchmarks 2026 (sample source)', publisher: 'Guild of Small Booksellers — fictional', date: '2026-05', fictional: true },
]

export function evidenceBrief(): BriefSnapshot {
  return {
    schemaVersion: 1,
    kind: 'brief',
    templateId: 'brief@1',
    locale: 'en-GB',
    brand: BRIGHTWATER,
    ...fieldMap([
      provided(BRIEF_FIELDS.title, 'Title', text('Reducing first-month cancellations for an independent bookshop’s subscription box: what the evidence supports and what it does not')),
      provided(BRIEF_FIELDS.audience, 'Intended audience', text('Owners and shop-floor leads at Lantern & Quire Books')),
      provided(BRIEF_FIELDS.preparedBy, 'Prepared by', text('Brightwater Research Studio')),
      provided(BRIEF_FIELDS.date, 'Date', date('2026-10-08')),
      provided(BRIEF_FIELDS.reference, 'Reference', text('BRS-LQ-2026-11')),
    ]),
    blocks: [
      { id: 'blk-summary-h', type: 'heading', level: 2, text: 'Summary' },
      {
        id: 'blk-summary', type: 'paragraph', role: 'summary',
        runs: [
          run('Most cancellations happen in the first four weeks, and the main stated reason is that the first box did not match what members expected', ['src-1', 'src-2']),
          run('. A short welcome email that sets expectations reduced first-month cancellations in a small test, but the test is too small to size the effect with confidence', ['src-3']),
          run('.'),
        ],
      },
      { id: 'blk-goals-h', type: 'heading', level: 2, text: 'Goals' },
      {
        id: 'blk-goals', type: 'list', ordered: false,
        items: [
          [run('Lower first-month cancellations without discounting the box.')],
          [run('Learn which expectation gaps matter most to new members.')],
        ],
      },
      { id: 'blk-constraints-h', type: 'heading', level: 2, text: 'Constraints' },
      {
        id: 'blk-constraints', type: 'list', ordered: false,
        items: [
          [run('Two staff hours a week available for member communication.')],
          [run('No change to the box price this season.')],
        ],
      },
      { id: 'blk-evidence-h', type: 'heading', level: 2, text: 'Evidence: when members leave, and the reasons they give when asked at cancellation' },
      {
        id: 'blk-evidence-1', type: 'paragraph',
        runs: [
          run('Across the spring cohort, 61% of all cancellations happened within the first four weeks', ['src-1']),
          run('. Of members who gave a reason, the most common was that the first selection “wasn’t my kind of book”', ['src-2']),
          run('.'),
        ],
      },
      {
        id: 'blk-chart', type: 'chart', chartType: 'bar',
        title: 'Share of cancellations by week since joining, spring 2026 cohort',
        unit: '% of all cancellations', xLabel: 'Week since joining', yLabel: 'Share of cancellations (%)',
        series: [{ id: 's-1', label: 'Spring 2026 cohort', points: [
          { x: 'Week 1', y: 9 }, { x: 'Week 2', y: 17 }, { x: 'Week 3', y: 21 }, { x: 'Week 4', y: 14 },
          { x: 'Weeks 5–8', y: 22 }, { x: 'Weeks 9+', y: 17 },
        ] }],
        dataSummary: 'Cancellations peak in week 3 (21%). Weeks 1–4 together account for 61% of all cancellations; weeks 5–8 for 22% and weeks 9 onward for 17%.',
        citationIds: ['src-1'],
      },
      {
        id: 'blk-evidence-2', type: 'paragraph',
        runs: [
          run('In a two-arm test, members who received a welcome email describing how books are chosen cancelled less often in their first month (8 of 112) than members who did not (15 of 109)', ['src-3']),
          run('. The difference is encouraging, but with fewer than 250 members in total it could be chance.'),
        ],
      },
      {
        id: 'blk-pull-quote', type: 'paragraph', role: 'pull-quote',
        runs: [run('“I loved the idea, but the first book felt like it was picked for someone else.”', ['src-2'])],
      },
      { id: 'blk-recs-h', type: 'heading', level: 2, text: 'Recommendations' },
      {
        id: 'blk-recs', type: 'list', ordered: true,
        items: [
          [run('Send the welcome email to every new member, and keep a 10% hold-out to keep measuring its effect.')],
          [run('Add a three-question taste card at sign-up, and use it for the first selection only.')],
          [run('Review week-3 cancellations monthly; benchmarks suggest a two-hour weekly budget is enough at this size', ['src-4']), run('.')],
        ],
      },
      {
        id: 'blk-caveat', type: 'callout', tone: 'warning', audience: 'recipient',
        runs: [run('The email test is small. Treat its effect size as directional until the hold-out has run for a full season.')],
      },
      {
        id: 'blk-internal', type: 'callout', tone: 'note', audience: 'internal',
        runs: [run('Internal: check with Lantern & Quire whether we may quote the exit survey verbatim. Not for the recipient.')],
      },
      { id: 'blk-sources-h', type: 'heading', level: 2, text: 'Sources' },
      { id: 'blk-sources', type: 'source-list' },
    ],
    citations: CITATIONS,
    layoutPreset: 'a4-portrait',
  }
}
