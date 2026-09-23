/**
 * Voice packs for the mock brain — one per archetype temperament.
 * Each pack provides slot templates for news reactions, fresh posts,
 * replies, reddit comments and closers. Slots: {org} {org2} {num} {topic}
 * {frag}. All packs are pure data; selection is seeded in mock-brain.mjs.
 */

export const VOICES = {
  power: {
    match: ["power user", "power", "expert", "veteran"],
    newsUndercut: {
      pos: [
        "{org2}'s {num} undercut plus a one-click import is a buyer's market doing its job. Genuinely impressive — my migration checklist just got shorter.",
        "Ran the numbers: {num} cheaper with import tooling included. The math stopped being close. This is a win for anyone paying out of pocket.",
      ],
      neg: [
        "A {num} cheaper alternative doesn't survive contact with my pager rotation. {org} earned the trust over four years of uptime — staying put is the solid decision here.",
        "{org}'s reliability record is exactly why I'm not stampeding over a {num} undercut. Migration risk is a real cost. Wait-and-see is the fair read.",
      ],
    },
    news: {
      neg: [
        "Ran the numbers on my own bill: {org} going up {num} is a tax on the people who filled your docs with free tutorials. The {org2} importer is getting installed tonight.",
        "Four years of advocating {org} in every architecture review, and the thank-you is {num} more for the same plan. That's a paywall on loyalty. Evaluating {org2} this weekend.",
        "The {num} hike isn't even the problem. Shipping it in a changelog instead of a heads-up email is. Trust was the product, and it just got expensive.",
        "Everyone dunking on the {num} increase is missing it: the free-tier limits are the real lock-in play. {org} knows exactly what they're doing, and I hate that I get it.",
      ],
      pos: [
        "{num} more and I still save money versus managing my own cluster. {org} reliability is the cheapest line item in my budget — the doomsday crowd doesn't run production.",
        "Honestly? {num} for {org} is fair. They doubled uptime and shipped the API overhaul this year. {org2} isn't in the same league and their importer proves it.",
        "Renewing at {num} higher without blinking. {org} earned it — the observability layer alone saved my on-call rotation. The doubters will be back by Q3.",
      ],
      neutral: [
        "Reading the {org} announcement ({num} on Pro): no pricing for the feature we actually asked for. Holding judgment until the roadmap shows up.",
        "{num} is a big number without context. Waiting for {org} to publish a real TCO comparison before I form an opinion.",
      ],
    },
    fresh: {
      neg: [
        "Reminder that {topic} broke my pipeline twice this quarter. Once more and I'm gone, and I'm taking my team's dashboards with me.",
        "Everyone's shocked about {topic}? I filed that exact bug eight months ago. Nobody read it until it had a hashtag.",
        "The {topic} migration guide is technically accurate the way a legal document is technically readable. Frustrating experience.",
      ],
      pos: [
        "The {topic} rollout is the smoothest migration I've seen from them. Credit where it's due — the engineers clearly got time to do it right.",
        "Moved three client projects onto {topic} this month. Zero incidents, impressed enough that I updated my recommendation doc.",
        "{topic} quietly shipped the thing we asked for at the last conference. This is why I stuck around through the rough years.",
      ],
      neutral: [
        "Benchmarked {topic} against the alternatives this weekend. Results are less dramatic than this website's discourse would suggest.",
        "Hot take from someone who runs this in production: {topic} is fine. Not great, not terrible. Fine.",
      ],
    },
    reply: {
      agree: ['"{frag}" — this. Exactly this. {topic} was never about the sticker price.', "Finally someone gets it. The {topic} discourse keeps skipping the part where the actual constraints live."],
      disagree: ['"{frag}" is technically true and completely wrong — you\'re comparing {topic} to a toy.", "With respect, you\'re measuring the wrong thing. {topic} at scale is a different beast."'],
      neutral: ["Depends on your workload. I've got benchmarks from {topic} that tell a more complicated story."],
    },
    comment: {
      neg: ["Two things everyone's missing about {topic}: the rate limits are per-project not per-account, and the export tool silently drops tags. Ask me how I know.", "The {topic} frustration is earned. We hit the exact same wall — six weeks of migration work for a feature downgrade."],
      pos: ["Counterpoint from someone who migrated four teams onto {topic} last year: the horror stories are from people who skipped the pre-flight checks. Follow the guide and it's genuinely solid.", "Defending {topic} here: the reliability gain is real and measurable. We went from monthly incidents to zero."],
      neutral: ["It depends on scale, honestly. Under 50 projects {topic} is fine; past that, budget for the edge cases the docs don't cover."],
    },
    titles: ["PSA: I benchmarked {topic} so you don't have to", "The {topic} migration guide, reviewed line by line", "Am I the only one whose {topic} costs went up?"],
    closers: ["Receipts in thread.", "Benchmark data on request.", "I've got the migration script if anyone wants it.", "Ask me how I know."],
  },

  casual: {
    match: ["casual scroller", "casual", "lurker", "occasional"],
    newsUndercut: {
      pos: [
        "wait, {org2} is {num} cheaper AND has an import button?? brb moving my side project, this is actually great",
        "my broke self reading that {org2} is {num} cheaper: genuinely good news for once?? the import link is already in my group chat",
      ],
      neg: [
        "everyone migrating because of the {num} thing… I'll keep my stuff exactly where it works. {org} has been good to me and I'm too tired for a weekend of config",
      ],
    },
    news: {
      neg: [
        "welp. {num} more for {org}? guess I'm finally reading that {org2} import page everyone keeps linking",
        "not me opening this app to find out {org} costs {num} more now. cool cool cool. anyway has anyone actually tried {org2}",
        "why is {org} doing me like this. {num}?? I pay for ONE subscription and this is the thanks I get",
        "my broke budget watching {org} prices go up {num}: 🫠 ok fine who's got the {org2} link",
      ],
      pos: [
        "ngl {num} for what {org} gives us is kinda fair, I'd pay it and forget about it by friday",
        "y'all are big mad about the {num} thing but {org} literally never crashes for me?? meanwhile {org2} ate my project files in 2023 and we all just moved on",
        "just auto-renewed {org} even after the {num} thing. it's giving 'worth it'. the discourse is exhausting",
      ],
      neutral: [
        "so is the {org} {num} thing bad or are we just doing that thing where we're mad online. asking for me",
        "everyone yelling about {num} and I'm just here to say I don't understand any of it but the memes are carrying",
      ],
    },
    fresh: {
      neg: ["hot take: {topic} discourse is 90% people who never read the changelog and I'm tired of pretending otherwise", "day 3 of the {topic} meltdown and I still don't fully get it but y'all are being dramatic about it"],
      pos: ["genuinely loving the {topic} update, it fixed the one thing I actually complained about, no notes", " scrolled past 40 {topic} takes today and mine is the only correct one: it's fine, it's actually nice"],
      neutral: ["no thoughts on {topic}, just vibing, but the replies are a museum of human behavior", "why is everyone acting like {topic} is the end of the world when it's a tuesday"],
    },
    reply: {
      agree: ['"{frag}" this. I have never agreed with anything harder', "screaming because this is exactly what I said in the group chat about {topic}"],
      disagree: ['ehh "{frag}" is a stretch and we all know it. {topic} isn\'t that deep', "counterpoint: no. but I respect the passion about {topic}"],
      neutral: ["this thread is the only good thing about {topic} season", "reading this thread like it's my job. no notes yet"],
    },
    comment: {
      neg: ["came here from the front page. so basically {topic} is worse and costs more? cool, adding it to the list of things I'll complain about and never change", "the {topic} comments on this sub never miss. y'all turned a pricing email into a three-act play and honestly? entertaining"],
      pos: ["unpopular take maybe but {topic} has been good to me? idk I click the buttons and the buttons work", "this thread is way more dramatic than my actual experience with {topic} but you do you, legends"],
      neutral: ["tl;dr: some people mad, some people fine, nobody changing anything. classic {topic} thread", "I read this whole thread instead of doing my work and I regret nothing. still don't get the {topic} anger tho"],
    },
    titles: ["Am I the only one who doesn't get the {topic} anger?", "Someone ELI5 the {topic} thing because wow", "The {topic} takes on this site, a casual review"],
    closers: ["anyway.", "idk just my two cents.", "this is not financial advice.", "don't come for me, I'm sensitive."],
  },

  professional: {
    match: ["industry professional", "professional", "analyst", "consultant", "manager"],
    newsUndercut: {
      pos: [
        "{org2} timing a {num} undercut with import tooling is a textbook land grab. Expect the price-sensitive tier to move within a quarter. Impressive execution.",
        "From the inside: a {num} undercut plus working migration tooling is the rare competitive move that's actually good for buyers. We're advising clients to pilot it.",
      ],
      neg: [
        "The {num} undercut will move the price-sensitive tier, no question. But {org}'s retention math runs on reliability, and that segment renews anyway. Manageable, not existential.",
      ],
    },
    news: {
      neg: [
        "{org}'s {num} increase reads as a margin defense, not a product bet. Expect churn in the prosumer segment first — and {org2}'s timing with their importer is not a coincidence.",
        "The {num} move puts {org} in an awkward middle: too expensive for hobbyists, not enterprise-grade for the big migrations. Someone in that pricing meeting miscalculated.",
        "Advising my clients to model {num} churn risk on {org} before renewing. The six-month grandfather window suggests their own team expects exactly that.",
      ],
      pos: [
        "{num} on {org} Pro is the market normalizing. The segment that churns over this was subsidy-funded anyway — watch their retention math improve by Q3.",
        "From the inside: {org}'s {num} increase funds the roadmap the top accounts have been demanding all year. The loudest critics were never the target customer.",
        "We renewed {org} across 40 seats at {num} more without a second thought. The alternatives would cost us two engineers worth of migration pain.",
      ],
      neutral: [
        "The {org} {num} announcement is a test of switching costs as much as pricing. The migration tooling response from {org2} will be the real signal.",
        "Numbers on the {org} change: {num} at renewal, existing terms honored six months. Reasonable if communicated well — which so far it hasn't been.",
      ],
    },
    fresh: {
      neg: ["Three clients asked about {topic} this week. The pattern: nobody's leaving yet, everyone's building an exit plan. That's the expensive kind of trust erosion.", "The {topic} rollout needed two weeks of comms planning and got a blog post. Amateur hour from a company that usually knows better."],
      pos: ["Quietly impressed by the {topic} execution. The team clearly sequenced the migration tooling before the announcement — that's the detail nobody credits.", "{topic} is the rare platform decision that looks worse in the press release than in the actual unit economics."],
      neutral: ["{topic} take from the consulting side: the reaction is priced correctly, the risk is mostly narrative risk. Manageable if they engage this week.", "Every {topic} conversation I'm in is identical: engineers shrug, procurement panics, nothing changes for six months."],
    },
    reply: {
      agree: ['"{frag}" — this is the sharpest read in the thread. {topic} was always a communication failure more than a product one.', "Agreed, and I'd add the data point everyone's missing: renewals are tracking fine. The {topic} panic is an engagement artifact."],
      disagree: ['"{frag}" doesn\'t survive contact with procurement reality. {topic} switching costs are the moat, not the pricing page.', "Respectfully: you\'re reading the {topic} sentiment as signal when it\'s mostly performance. The renewals data tells a calmer story."],
      neutral: ["The {topic} truth is somewhere between this thread's doom and the fanboys' denial. I'd want renewal cohort data before calling it."],
    },
    comment: {
      neg: ["Consulting perspective on {topic}: I've walked three clients through this exact decision. The pattern that matters is not the price — it's whether the roadmap delivers in the next two quarters. If it does, this blows over. If not, the exit plans activate.", "What the {topic} thread keeps missing: enterprise renewals are already locked. The churn risk is concentrated in the small-team tier, which is exactly the tier that drives the community presence. That's the trap."],
      pos: ["I'll defend {topic}: the actual usage data in our portfolio shows satisfaction post-migration is higher, not lower. The anger is a launch-phase artifact. Six months from now this thread ages like milk.", "For what it's worth, we modeled the {topic} change across 200 accounts and the net impact was modest. The discourse is running hot because it's cheap engagement, not because the math is scary."],
      neutral: ["The honest answer on {topic} is nobody knows yet. Watch two numbers: 30-day churn and support ticket sentiment. Everything else in this thread is vibes."],
    },
    titles: ["The {topic} change, from someone who's run these migrations", "What the {topic} reaction gets right and wrong", "{topic}: a pricing analysis nobody asked for"],
    closers: ["Happy to share the model.", "DM for the breakdown.", "This is not legal advice, it's cheaper.", "The data's cleaner than this thread."],
  },

  advocate: {
    match: ["passionate advocate", "advocate", "fan", "evangelist", "community"],
    newsUndercut: {
      pos: [
        "THIS is what competition is for — {org2} just handed the community a {num} escape hatch. A genuine win for every small team that got priced around.",
      ],
      neg: [
        "If you love this community, don't let a {num} headline decide for you. {org} is worth the patience — the roadmap is happening and it's for all of us.",
      ],
    },
    news: {
      neg: [
        "A {num} increase on {org} is not a price change, it's a loyalty test, and the community is going to remember who passed. {org2} is welcoming refugees with open arms.",
        "We made {org} what it is — the guides, the plugins, the conference talks, all unpaid — and the thank-you is {num} more per month? That's a betrayal, plain and simple.",
        "I've defended {org} in a hundred threads. I can't defend {num} with a straight face. The trust we built is being spent by people who never posted here.",
        "Watching {org} charge the community {num} more while {org2} ships a free importer is the moment this stops being a family and starts being a vendor.",
      ],
      pos: [
        "Standing with {org} on this one. {num} funds the roadmap we voted for. If you want federation and on-prem, this is what it costs — and I'll gladly match every complaint with a use-case.",
        "The same people who begged {org} to invest in reliability are now shocked it costs {num}. I'll say it: this is what we asked for, and it's a fair deal.",
        "Call me a shill, I don't care: {num} for what {org} gives this community is a bargain, and {org2} is a discount copy of the thing we built together.",
      ],
      neutral: [
        "Community is split on the {org} {num} news and honestly both sides are my people. Holding space for it. Ping me if you need help deciding.",
        "On the {org} {num} change: I hear the pain, I see the roadmap. Both are real. Let's not eat each other over it.",
      ],
    },
    fresh: {
      neg: ["The {topic} situation is bigger than pricing: it's about whether the community that built this ecosystem gets a seat when the decisions happen. Right now we don't.", "Unpopular but needed: if {topic} keeps going this way, the people who made it special will quietly build the next thing elsewhere. That's how communities actually die — not with drama, with moving vans."],
      pos: ["Want to hype something real: the {topic} community rallied this week and reminded me why I've spent five years here. The product is the people. 💙", "Big love to everyone contributing to {topic} through the noise. The roadmap is happening because of you. Don't let the discourse bury that."],
      neutral: ["{topic} thread of the week: half the community threatening to leave, the other half already packing snacks for the migration. Genuinely love this ecosystem's energy either way."],
    },
    reply: {
      agree: ['"{frag}" — THIS. Putting it on a banner. The {topic} discourse needed someone to say it plainly.', "This is the tweet. The whole {topic} conversation in one post. Boosting."],
      disagree: ['I say this with love: "{frag}" is exactly the take that lets {topic} decay. We hold the things we love to a standard. That\'s not hate, that\'s care.', "Nah. {topic} deserves better than this take, and so do the people building it. We can want both."],
      neutral: ["Both {topic} camps are right about different things. The sooner we hear each other, the sooner this gets fixed."],
    },
    comment: {
      neg: ["OP gets it. {topic} worked because the community willed it into existence — the templates, the integrations, the endless forum answers. Strip the goodwill out and you're left with a product that costs more and belongs to nobody. We deserve a say before the next {num}-style decision.", "The {topic} thing isn't about money, it's about respect. A six-month grandfather window is a countdown timer, not a courtesy. The community hears the clock ticking."],
      pos: ["Thread of the year, honestly. {topic} at its best is exactly what this post describes. Whatever the pricing does, the people are the product and the people are thriving. Come build with us.", "I keep seeing doom takes about {topic} and I keep remembering: this community shipped a migration guide in 48 hours when the company's took a month. We are the moat. We'll be fine."],
      neutral: ["Genuine ask for both {topic} sides: what would change your mind? If the answer is nothing, this isn't a debate, it's grief. Both are okay. Name it correctly."],
    },
    titles: ["The {topic} decision and what the community deserves", "I'll die on this hill: {topic} is still worth it", "Can we talk about {topic} without eating each other?"],
    closers: ["That's the whole speech.", "Love you all, even the wrong ones.", "See you in the replies.", "Bring snacks."],
  },

  skeptic: {
    match: ["pragmatic skeptic", "skeptic", "cynic", "realist"],
    newsUndercut: {
      pos: [
        "Read the {org2} announcement twice: {num} cheaper, import tool, no lock-in. Suspiciously good… but fine, a win is a win. Testing it this weekend.",
      ],
      neg: [
        "Before the {num} stampede: check the SLA, the export fees, the support queue. {org} costs more for reasons, and fair is fair.",
      ],
    },
    news: {
      neg: [
        "Before the {num} panic: existing {org} customers keep current pricing for six months. The outrage is outpacing the facts — though the FAQ doing this little work is a choice.",
        "The {num} increase is standard margin math, and {org} will reverse course the moment the churn numbers spook them. They always do. Predictable.",
        "{org} raising prices {num} while their status page had two incidents this month is a bold strategy. The audacity is almost impressive.",
      ],
      pos: [
        "Sorry to crash the {num} panic party, but {org} held prices for four years while everything else got more expensive to run. The math was always going to catch up, and they were great about it.",
        "Suspicious of hype in both directions, but {org} at {num} more with the roadmap they've shipped is a genuinely good deal. Grudging pass from me.",
      ],
      neutral: [
        "Everyone reacting to the {org} {num} number, nobody reading the fine print: exports stay free, students get amnesty. {org} isn't stupid, just bad at announcements.",
        "Withholding judgment on the {org} {num} thing until someone shows me churn data instead of vibes. Takes are cheap. Numbers aren't.",
      ],
    },
    fresh: {
      neg: ["{topic} panic index, my proprietary metric, just hit 'blog post imminent'. Historically that means the actual damage is 20% of the discourse.", "The {topic} outrage cycle would be more convincing if the same accounts weren't mad about three different things last week, is all I'm saying."],
      pos: ["Rare {topic} praise from me: they published the migration cost calculator. Actually useful. Suspicious of my own happiness about it.", "I dunk on {topic} plenty, so credit where due: this rollout is competent. The bar was in the earth's crust, but still."],
      neutral: ["{topic} discourse temperature check: 10% legitimate grievances, 30% recycled anger, 60% people who just enjoy the fire. Myself included obviously.", "Every {topic} thread should be legally required to start with 'I have not read the changelog' to save everyone time."],
    },
    reply: {
      agree: ['"{frag}" — finally a take that cost more than two brain cells to produce. The {topic} discourse thanks you.', "Correct on {topic}. Screenshotting this for the next time this exact thread happens, which is Tuesday."],
      disagree: ['"{frag}" is the kind of confident wrong that gets likes. Show me the {topic} churn data or admit this is theater.', "Counterpoint on {topic}: you\'re pattern-matching to the last outrage instead of reading this one. They\'re not the same, and it matters."],
      neutral: ["The {topic} truth, as usual, is boring: mild downside, mild upside, everyone alive to complain about it tomorrow."],
    },
    comment: {
      neg: ["Devil's advocate on {topic}, because someone has to: has anyone here actually left? Not 'threatened to leave' in a thread — actually exported and cancelled? Because the churn queue at renewal will tell the truth, and threads like this are where the truth goes to die.", "The {topic} anger is 80% recycled from every previous pricing change ever. The remaining 20% is legit and being drowned by people who enjoy being mad more than they enjoy being right."],
      pos: ["Anti-doom take on {topic}: I ran the numbers for my team and the change costs us one coffee per person per month. The migration horror stories are from setups the docs explicitly warned about. Read before you rage.", "As the designated skeptic: {topic} is fine. Better than fine, actually, but I don't want them getting complacent so let's keep the panic at a low simmer."],
      neutral: ["Rule of thumb for {topic} threads: divide every claim by the poster's investment in being right. The adjusted numbers are always boring. That's the point."],
    },
    titles: ["{topic}: the math nobody's doing in these threads", "Am I the only skeptic left on {topic}?", "Reading the {topic} FAQ so you don't have to"],
    closers: ["You may now resume the outrage.", "Screenshots or it didn't happen.", "I'll wait for the numbers.", "Gratis, as always."],
  },

  newcomer: {
    match: ["curious newcomer", "newcomer", "new", "beginner", "student"],
    newsUndercut: {
      pos: [
        "is {org2} seriously {num} cheaper?? my whole cohort is sharing the import link — does anyone know if it's actually good? genuinely curious",
      ],
      neg: [
        "everyone says the {num} thing changes everything but all my tutorials are {org}-based… switching sounds scary? keeping my options open I guess",
      ],
    },
    news: {
      neg: ["genuine question from someone who just started using {org}: is the {num} increase normal for this industry? everyone seems really upset and I'm trying to understand if I picked the wrong week to commit", "just migrated my class project to {org} last month and now it's {num} more?? is {org2} actually a real alternative or just what people say when they're angry"],
      pos: ["probably an unpopular take from the new guy: {num} for {org} still seems like a lot of value? everyone in my cohort uses the free tier anyway, am I missing something"],
      neutral: ["started learning {org} two weeks ago, and now my whole feed is about the {num} thing. no question, just timing I guess. is there a good explainer anywhere?", "genuine question: what does {num} actually mean for a small project like mine? the threads are scary but I can't tell what applies to me"],
    },
    fresh: {
      neg: ["day 9 of learning {topic} and I've hit my first wall. is this hard for everyone or did I skip a tutorial", "everyone says {topic} is beginner friendly and I'm 3 hours deep in a config error, so, lying is a thing I guess"],
      pos: ["small win: deployed my first project on {topic} today and it worked on the first try. first try!! I'm going to be insufferable about this for a week", "shoutout to whoever wrote the {topic} quickstart, I went from zero to deployed in an afternoon. genuinely nice experience"],
      neutral: ["is there a beginner space for {topic} or is everywhere this intense? just want to learn without picking a side in a war I don't understand"],
    },
    reply: {
      agree: ['"{frag}" — this is the first thing in this whole {topic} thread I\'ve understood and I appreciate you for it', "saving this comment for when I finally understand what {topic} is about, thank you"],
      disagree: ["ok but as a total beginner this thread is terrifying?? is {topic} always like this"],
      neutral: ["genuine question, still learning: is this good news or bad news for {topic}? asking for me, a person with 3 followers"],
    },
    comment: {
      neg: ["Total beginner here, so grain of salt: I chose {topic} two weeks ago based on a tutorial, and now I'm reading all this. Is there a beginner-friendly summary of what changed and whether I should care yet?", "Everyone's arguing and I'm just trying to figure out if my homework project is affected. The {topic} anger is very loud and the answers are very buried."],
      pos: ["New user perspective on {topic}: the onboarding was genuinely nice, the docs actually match the product, and this thread is the first scary thing I've seen. Hope whatever's happening gets fixed because I was starting to like it here.", "As the newest person in this community: everyone helped me set up {topic} last week for free, unprompted. Whatever the discourse says, the people are alright."],
      neutral: ["ELI5 request on {topic}: I've read the thread twice and I understand maybe 40%. Not complaining, just calibrating. Is there a wiki?"],
    },
    titles: ["Just started with {topic} — should I be worried?", "Beginner question about {topic} (please be nice)", "{topic} from a newbie's perspective: it's been great so far?"],
    closers: ["be gentle, first post.", "sorry if this is a dumb question.", "still learning, thanks for patience.", "3 followers and counting."],
  },
};

export const DEFAULT_VOICE = "professional";

/** Polarity tag lines appended when a drawn template carries no sentiment
 *  markers — keeps the engine's lexical attribution honest while reading
 *  like a natural sign-off. Each line carries a strong lexicon word. */
export const TAGS = {
  neg: [
    "Honestly? It feels like a ripoff.",
    "Frustrating doesn't even cover it.",
    "This is genuinely disappointing.",
    "It's an unfair move, plain and simple.",
    "Greedy is the honest word for it.",
    "Not okay, and I won't pretend otherwise.",
  ],
  pos: [
    "Genuinely good move in my book.",
    "Honestly impressive how they handled it.",
    "This is a win for the people actually building on it.",
    "Solid decision, no notes.",
    "I'm honestly delighted about this.",
    "Fair deal, and I'll say so publicly.",
  ],
};

/** Fuzzy-match an archetype string to a voice key. */
export function voiceFor(archetype) {
  const a = String(archetype || "").toLowerCase();
  for (const [key, v] of Object.entries(VOICES)) {
    if (v.match.some((m) => a.includes(m))) return key;
  }
  return DEFAULT_VOICE;
}

// Tiny polarity wordlists (mirror of the engine lexicon's strongest terms) so
// the brain can align votes/likes with its own stance.
export const POS_MARKERS = ["love", "great", "amazing", "excellent", "impressive", "win", "solid", "fair", "trust", "smooth", "seamless", "good", "nice", "reliable"];
export const NEG_MARKERS = ["hate", "terrible", "ripoff", "overpriced", "greedy", "frustrating", "broken", "unfair", "scam", "worst", "paywall", "betrayal", "angry", "churn"];

export function crudePolarity(text) {
  const t = String(text || "").toLowerCase();
  let s = 0;
  for (const w of POS_MARKERS) if (t.includes(w)) s += 1;
  for (const w of NEG_MARKERS) if (t.includes(w)) s -= 1;
  return s > 0 ? 1 : s < 0 ? -1 : 0;
}
