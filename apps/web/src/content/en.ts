/**
 * Every word on the page. Copy reuses the app's own lines where they exist (welcome screen, tour, help) and every
 * claim matches the app's code; runners, clubs, places and times are invented. Game numbers (loop sizes, costs)
 * stay out because the app still marks every threshold as proposed.
 */
export const copy = {
  meta: {
    title: 'Loopfield: Run a loop. Claim the ground.',
    description:
      'Loopfield turns the loops you run into territory on a shared map. Hold your ground, race for route titles and run with your club.'
  },
  nav: [
    { id: 'how', label: 'How it works' },
    { id: 'rivals', label: 'Rivals' },
    { id: 'titles', label: 'Titles' },
    { id: 'clubs', label: 'Clubs' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'faq', label: 'FAQ' }
  ],
  skip: 'Skip to content',
  getApp: 'Get the app',
  joinWaitlist: 'Join the waitlist',

  hero: {
    kicker: 'The running game played on your streets',
    lines: ['Run a loop.', 'Claim the ground.'],
    body: 'Loopfield turns the loops you run into territory on a shared map. Hold your ground, race for route titles and run with your club.',
    secondary: 'See how it works',
    chips: ['Claim land with loops', 'Hold route titles', 'Run with clubs', 'Health stays on your phone'],
    note: 'Free to download for iPhone and Android.',
    waitlistNote: 'Coming soon to iPhone and Android.',
    scan: 'Scan to get the app'
  },

  how: {
    kicker: 'How it works',
    lines: ['Your run', 'draws the map.'],
    steps: [
      { title: 'Start a territory run.', body: 'Hit record on your streets, in a park or round the block.' },
      { title: 'Close the loop.', body: 'Finish near where you started. The gap glows orange as you come back.' },
      {
        title: 'The ground turns violet.',
        body: 'Every cell fully inside your loop becomes yours on the shared map, for every runner to see.'
      }
    ],
    counterLabel: 'cells'
  },

  turn: {
    kicker: 'Your turn',
    lines: ['Your turn.'],
    body: 'Draw a loop with your finger or mouse. End where you began.',
    start: 'Press on the board and draw a loop.',
    close: 'Come back to the start to close it.',
    small: 'Bigger. A loop needs ground inside.',
    yours: (n: number) => `${n} cells are yours.`,
    took: (n: number) => `${n} taken from rivals. The newest loop wins.`,
    grey: 'Grey cells are never awarded.',
    cells: 'cells',
    cta: 'Now try your actual streets.',
    auto: 'Draw one for me',
    again: 'Draw again',
    boardLabel: 'A practice board of hexagon cells. Draw a closed loop to claim the cells inside it.'
  },

  rivals: {
    kicker: 'Rivals',
    lines: ['Ground', 'changes hands.'],
    body: 'The newest loop takes each cell. A rival can run through your streets tonight; you can take them back tomorrow.',
    facts: [
      { icon: 'hexagon', text: 'Lost ground stays outlined in your colour.' },
      { icon: 'bolt', text: 'Every run earns movement points to reclaim it.' },
      { icon: 'lock', text: 'Grey zones are never awarded.' }
    ],
    toast: { who: 'Kai', text: (n: number) => `took ${n} of your cells near the canal.`, when: 'now' },
    reclaim: { who: 'You', text: (n: number) => `took ${n} back with movement points.`, when: 'now' }
  },

  titles: {
    kicker: 'Route titles',
    lines: ['Fastest time', 'holds the title.'],
    body: 'Approved routes run one way. Make a timed attempt; the fastest valid time takes the title. Titles and land are separate games, so a sprinter and a long-hauler can both win.',
    time: { minutes: 11, seconds: 42 },
    chip: 'Title · Riverside 3K',
    trust: 'Every attempt is checked for GPS quality, bikes and cars.'
  },

  clubs: {
    kicker: 'Clubs and seasons',
    lines: ['Bring your crew.'],
    body: 'Join or start a club, chat, run club races and events, and climb the standings together.',
    season: 'Seasons start empty. The all-time map remembers.',
    scopes: ['Everyone', 'Country', 'City', 'Friends', 'Club'],
    card: {
      name: 'Night Owls RC',
      meta: '38 members · Club race',
      standing: '2nd',
      standingLabel: 'this season',
      cells: '1,240',
      cellsLabel: 'cells held',
      chat: [
        { who: 'Mara', text: 'Canal loop at 6? Bring the new folks.' },
        { who: 'Dev', text: 'In. Let’s take the bridge back.' }
      ]
    }
  },

  progress: {
    kicker: 'Progress',
    lines: ['Every run counts.'],
    body: 'Weekly distance, goals, personal bests and badges. Connect Apple Health or Health Connect for a dashboard that stays on your phone.',
    badges: [
      { metal: 'bronze', icon: 'route', label: 'Route' },
      { metal: 'silver', icon: 'calendar', label: 'Streak' },
      { metal: 'gold', icon: 'hexagon', label: 'Ground' },
      { metal: 'platinum', icon: 'trophy', label: 'Titles' }
    ],
    week: {
      label: 'This week',
      total: '23.4',
      unit: 'km',
      runs: (n: number) => `${n} runs`,
      days: [
        { d: 'Mon', v: 5.2 },
        { d: 'Tue', v: 0 },
        { d: 'Wed', v: 6.8 },
        { d: 'Thu', v: 3.1 },
        { d: 'Fri', v: 0 },
        { d: 'Sat', v: 8.3 },
        { d: 'Sun', v: 0 }
      ]
    }
  },

  privacy: {
    kicker: 'Privacy',
    lines: ['Your run', 'stays yours.'],
    lead: 'Other runners see the ground you claim, never your raw GPS trace.',
    cards: [
      {
        icon: 'heart',
        title: 'Health stays on your phone.',
        body: 'Apple Health and Health Connect data powers a private dashboard. It is never uploaded or shared.'
      },
      { icon: 'eye-off', title: 'No raw traces.', body: 'Other runners see your results, not your GPS trace.' },
      { icon: 'flag', title: 'Start and finish hidden.', body: 'Shared runs are trimmed, so your front door stays private.' },
      { icon: 'calendar', title: 'Published later.', body: 'Runs appear after a delay, so nobody can follow you live.' },
      { icon: 'camera', title: 'Clean photos.', body: 'Location data is removed before a photo uploads.' },
      {
        icon: 'lock',
        title: 'Your audience, your call.',
        body: 'Share each run with exactly who you choose. Analytics only if you opt in.'
      }
    ]
  },

  app: {
    kicker: 'The app',
    lines: ['The whole game', 'in your pocket.'],
    screens: [
      { id: 'map', title: 'Map', body: 'See who holds what nearby.' },
      { id: 'record', title: 'Record', body: 'One tap, big numbers.' },
      { id: 'summary', title: 'Run summary', body: 'Cells claimed, pace and splits.' },
      { id: 'progress', title: 'Progress', body: 'Goals and personal bests.' },
      { id: 'clubs', title: 'Clubs', body: 'Chat, races and standings.' }
    ],
    disclaimer: 'Screens show invented runners and places.'
  },

  final: {
    lines: ['Your streets', 'are unclaimed.'],
    body: 'For now. Get Loopfield and take them first.',
    waitlistBody: 'For now. Join the waitlist and claim them first.'
  },

  waitlist: {
    title: 'Get the first invite',
    email: 'Email',
    consent: 'Email me when Loopfield launches. Unsubscribe any time.',
    submit: 'Join the waitlist',
    sending: 'Sending…',
    sent: 'Check your inbox: one tap confirms your spot.',
    confirmed: 'You’re on the list. We’ll email you when Loopfield launches.',
    failed: 'That didn’t go through. Try again in a minute.',
    invalid: 'Check the email address.',
    consentNeeded: 'Tick the box so we can email you.',
    closed: 'Sign-ups open soon. Check back in a few days.'
  },

  faq: {
    kicker: 'FAQ',
    title: 'Questions',
    items: [
      {
        id: 'free',
        q: 'Is Loopfield free?',
        a: 'Loopfield is free to download, and the pilot is free to play.'
      },
      {
        id: 'where',
        q: 'Where can I play?',
        a: 'Loopfield is opening city by city. Join the waitlist and we’ll email you when it launches.'
      },
      {
        id: 'loop',
        q: 'What counts as a loop?',
        a: 'Start a territory run and finish near where you started. Cells fully inside an eligible loop become yours. The rules are still being tuned in field tests.'
      },
      {
        id: 'watch',
        q: 'Do I need a watch?',
        a: 'No. Loopfield records runs with your phone’s GPS. Apple Health and Health Connect are optional.'
      },
      {
        id: 'see',
        q: 'What do other runners see?',
        a: 'The land you hold, your results and what you choose to share. Never your raw GPS trace or your health data.'
      },
      {
        id: 'cheat',
        q: 'Can people cheat?',
        a: 'Every run is checked for GPS quality, bikes and cars, and suspicious results go to review.'
      },
      {
        id: 'delete',
        q: 'How do I delete my account?',
        a: 'In the app, go to Settings, then Account and data, then Delete account. You can also ask from our account deletion page.',
        link: { text: 'account deletion page', href: '/delete-account' }
      },
      { id: 'who', q: 'Who can join?', a: 'Loopfield is for adults (18+).' }
    ]
  },

  footer: {
    tagline: 'Run a loop. Claim the ground.',
    iphone: 'Get it for iPhone',
    android: 'Get it for Android',
    links: [
      { href: '/privacy', label: 'Privacy' },
      { href: '/terms', label: 'Terms' },
      { href: '/support', label: 'Support' },
      { href: '/delete-account', label: 'Delete account' },
      { href: '/press', label: 'Press kit' }
    ],
    apple: 'Apple and the Apple logo are trademarks of Apple Inc., registered in the U.S. and other countries.',
    google: 'Google Play and the Google Play logo are trademarks of Google LLC.',
    motionOn: 'Pause motion',
    motionOff: 'Play motion'
  }
} as const;

export type IconName =
  | 'hexagon'
  | 'bolt'
  | 'lock'
  | 'route'
  | 'calendar'
  | 'trophy'
  | 'heart'
  | 'eye-off'
  | 'flag'
  | 'camera'
  | 'arrow-right'
  | 'map'
  | 'record'
  | 'progress'
  | 'clubs'
  | 'chat'
  | 'compass'
  | 'share'
  | 'plus'
  | 'check'
  | 'close'
  | 'home';
