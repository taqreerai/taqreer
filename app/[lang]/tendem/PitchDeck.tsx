"use client";

// 27-slide scroll deck pitching Taqreer to Tendem and Toloka. English-only by
// design (the audience is Toloka), so the chrome is hard-pinned dir="ltr" even
// under /ar/tendem; the Arabic samples inside carry their own dir="rtl".
// Numbers were verified against prod + IMF DataMapper + toloka.ai on
// 2026-08-26; slide 19 reads from that production snapshot.

import { useEffect, useRef, useState } from "react";
import "./pitch.css";

type Tone = "blue" | "mint" | "gold";
type SlideProps = { children: React.ReactNode; number: number; tone?: Tone; chapter?: string };

const tests = [
  "Does the Arabic feel authored, not translated?",
  "Do mixed Arabic-English paragraphs survive PPTX?",
  "Does the exported PowerPoint match the approved composition?",
  "Can existing decks be improved without losing their message?",
  "Can the system learn a visual language from a reference?",
  "Can AI inspect and repair its own rendered output?",
  "Does generated imagery respect each Gulf culture?",
];

function Slide({ children, number, tone = "blue", chapter = "" }: SlideProps) {
  return (
    <section className={`slide tone-${tone}`} data-slide={number}>
      <div className="topline"><span>{chapter}</span><span>{String(number).padStart(2, "0")}</span></div>
      {children}
    </section>
  );
}

function Section({ number, index, title, subtitle, tone = "blue" }: { number: number; index: number; title: string; subtitle: string; tone?: Tone }) {
  return (
    <Slide number={number} tone={tone} chapter={`Chapter ${String(index).padStart(2, "0")}`}>
      <div className="section-break">
        <div className="section-index">{String(index).padStart(2, "0")}</div>
        <div className="section-copy"><span /><h2>{title}</h2><p>{subtitle}</p></div>
      </div>
    </Slide>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}

function Next({ children }: { children: React.ReactNode }) {
  return <p className="next">{children}<b>↓</b></p>;
}

export function PitchDeck() {
  const [active, setActive] = useState(0);
  const deck = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = deck.current;
    if (!root) return;
    const slides = [...root.querySelectorAll<HTMLElement>(".slide")];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(slides.indexOf(visible.target as HTMLElement));
    }, { root, threshold: [0.55, 0.8] });
    slides.forEach((slide) => observer.observe(slide));
    const keys = (event: KeyboardEvent) => {
      const forward = ["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key);
      const back = ["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key);
      if (!forward && !back) return;
      event.preventDefault();
      slides[Math.max(0, Math.min(slides.length - 1, active + (forward ? 1 : -1)))]?.scrollIntoView({ behavior: "smooth" });
    };
    window.addEventListener("keydown", keys);
    return () => { observer.disconnect(); window.removeEventListener("keydown", keys); };
  }, [active]);

  return (
    <main className="tq-pitch deck" dir="ltr" ref={deck}>
      <nav className="deck-nav" aria-label="Presentation navigation">
        <button aria-label="Previous slide" onClick={() => deck.current?.querySelectorAll(".slide")[Math.max(0, active - 1)]?.scrollIntoView({ behavior: "smooth" })}>←</button>
        <span>{String(active + 1).padStart(2, "0")} / 27</span>
        <button aria-label="Next slide" onClick={() => deck.current?.querySelectorAll(".slide")[Math.min(26, active + 1)]?.scrollIntoView({ behavior: "smooth" })}>→</button>
      </nav>

      <Slide number={1}>
        <div className="cover-grid">
          <div className="hero-copy">
            <p className="eyebrow">GCC expertise · hybrid quality · regional growth</p>
            <h1>Tendem brings humans into the agent.<br /><em>I can bring the GCC into the loop.</em></h1>
            <p className="lede">A case for joining Tendem and Toloka with the regional expertise, product systems, and Arabic presentation technology I built through Taqreer.ai.</p>
          </div>
          <div className="product-window">
            <div className="window-bar"><i /><i /><i /><span>taqreer.ai / quality gate</span></div>
            <div className="window-body">
              <small>GCC PRESENTATION TASK</small>
              <p dir="rtl">حقق تقرير <bdi dir="ltr">Q1 2026</bdi> نمواً بنسبة <bdi dir="ltr">25%</bdi> في السوق السعودي.</p>
              <div className="gate-row"><span>Arabic layout</span><b>Verified</b></div>
              <div className="gate-row"><span>Mixed-script PPTX</span><b>Verified</b></div>
              <div className="gate-row"><span>Cultural context</span><b>Verified</b></div>
              <div className="gate-row"><span>Editable delivery</span><b>Verified</b></div>
            </div>
          </div>
        </div>
        <Next>First, why I understand this market from the inside</Next>
      </Slide>

      <Section number={2} index={1} title="Founder-market fit" subtitle="Regional knowledge built through 12 years of practice" tone="mint" />

      <Slide number={3} tone="mint">
        <div className="profile-grid">
          <div className="identity"><img src="/pitch/oussama.jpeg" alt="Oussama" /><div><p className="eyebrow">Oussama</p><h2>Design Lead.<br />Art Director.<br />Product Designer.</h2></div></div>
          <div className="statement"><p>12 years in the Middle East shaped my understanding of regional visual language, institutional expectations, brands, and decision-making culture.</p><div className="pull">I designed, built, funded, and operated Taqreer independently in my free time, translating that regional experience into a working AI product.</div></div>
        </div>
        <Next>That experience points to a compact market with outsized economic influence</Next>
      </Slide>

      <Section number={4} index={2} title="The GCC opportunity" subtitle="A high-value market with distinct institutional expectations" />

      <Slide number={5}>
        <h2>Six connected markets with outsized regional influence</h2>
        <div className="metrics"><Metric value="$2.57T" label="projected nominal GDP, 2026" /><Metric value="63.7M" label="projected population, 2026" /><Metric value="$40.3K" label="GDP per resident, 2026" /></div>
        <div className="country-line">Saudi Arabia · UAE · Qatar · Kuwait · Oman · Bahrain</div>
        <p className="wide-copy">A compact economic bloc linked by language, business networks, public-sector ambition, and a shared expectation for premium communication.</p>
        <p className="source">Source: IMF World Economic Outlook, April 2026. GCC totals calculated from the six country projections.</p>
        <Next>The buyers are specific, and so are their quality expectations</Next>
      </Slide>

      <Slide number={6} tone="mint">
        <h2>They pay for confidence, precision, and institutional credibility</h2>
        <div className="buyer-grid">
          <article><small>01</small><b>Governments and sovereign entities</b><p>Executive communication, governance, national identity, and Arabic authority.</p></article>
          <article><small>02</small><b>National champions and enterprises</b><p>Brand consistency, speed, secure workflows, and editable deliverables.</p></article>
          <article><small>03</small><b>Consultancies, agencies, and universities</b><p>High-volume delivery without compromising regional quality.</p></article>
          <aside><small>THE BUYING TEST</small><strong>Native Arabic</strong><strong>Cultural precision</strong><strong>Brand control</strong><strong>PowerPoint fidelity</strong></aside>
        </div>
        <Next>One failure can disqualify the entire product</Next>
      </Slide>

      <Section number={7} index={3} title="The last-mile quality problem" subtitle="The work can be 95% complete and still be unusable in the GCC" tone="gold" />

      <Slide number={8} tone="gold">
        <h2>The browser looks right. PowerPoint breaks the paragraph.</h2>
        <div className="bidi-grid">
          <div><h3>Mixed scripts expose the real RTL gap</h3><p>Arabic presentations constantly include English names, product terms, dates, percentages, and acronyms. During PPTX delivery, these elements can jump, reverse, or detach from the words they belong to.</p><ul><li>Reading order changes</li><li>Numbers move to the wrong phrase</li><li>Punctuation lands on the wrong side</li><li>The editable file no longer matches the approved design</li></ul></div>
          <div className="contrast"><div><small>APPROVED IN BROWSER</small><p dir="rtl">حقق تقرير <bdi dir="ltr">Q1 2026</bdi> نمواً بنسبة <bdi dir="ltr">25%</bdi> في السوق السعودي.</p></div><b>DOM → PPTX</b><div className="bad"><small>BROKEN AFTER EXPORT</small><p dir="rtl"><bdi dir="ltr">Q1 2026</bdi> حقق تقرير في السوق السعودي <bdi dir="ltr">25%</bdi> نمواً بنسبة.</p></div></div>
        </div>
        <Next>This is exactly where automated work needs a domain-specific quality gate</Next>
      </Slide>

      <Section number={9} index={4} title="The GCC quality gate" subtitle="Seven checks that turn localization into trusted delivery" tone="gold" />

      <Slide number={10} tone="gold">
        <h2>Finished work for the GCC must pass these tests</h2>
        <div className="test-grid">{tests.map((test, index) => <div key={test}><span>{String(index + 1).padStart(2, "0")}</span><b>{test}</b></div>)}</div>
        <div className="bridge">Taqreer is working proof that these checks can be designed into the workflow.</div>
      </Slide>

      <Slide number={11}>
        <h2>Arabic quality lives in the details buyers notice</h2>
        <div className="feature-grid">
          <div className="feature-list"><article><span>01</span><b>Direction</b><p>Correct RTL anchoring, reading order, and hierarchy.</p></article><article><span>02</span><b>Typography</b><p>Connected glyphs, authentic weights, and embedded Arabic fonts.</p></article><article><span>03</span><b>Composition</b><p>Layouts designed for Arabic rather than mirrored after translation.</p></article></div>
          <div className="arabic-card"><small>ARABIC-NATIVE OUTPUT</small><h3 dir="rtl">من الفكرة إلى عرض احترافي</h3><p dir="rtl">تصميم يحافظ على الهوية، وضوح المعلومات، ودقة اللغة العربية.</p><div><span>RTL</span><span>EDITABLE</span><span>BRAND-SAFE</span></div></div>
        </div>
        <Next>The hardest test is when two writing systems share one exported paragraph</Next>
      </Slide>

      <Slide number={12} tone="mint">
        <h2>One paragraph. Multiple directions. Stable output.</h2>
        <div className="mixed-proof">
          <div><small>EDITABLE POWERPOINT OUTPUT</small><p dir="rtl">حقق فريق المبيعات في <bdi dir="ltr">Q1 2026</bdi> نمواً بنسبة <bdi dir="ltr">25%</bdi> مقارنة بالعام السابق.</p><div className="runs"><span>Arabic</span><span>Q1 2026</span><span>Arabic</span><span>25%</span><span>Arabic</span></div></div>
          <div className="steps"><article><b>Preserve the relationship</b><p>Arabic, English, numbers, and punctuation remain connected.</p></article><article><b>Write for PowerPoint</b><p>Directional and language properties survive inside the editable PPTX.</p></article><article><b>Verify the result</b><p>The file is checked against the composition approved on screen.</p></article></div>
        </div>
        <div className="bridge">A core GCC requirement, not a localization detail.</div>
      </Slide>

      <Slide number={13} tone="mint">
        <h2>I built a custom DOM-to-PPTX delivery system</h2>
        <div className="process"><article><span>01</span><b>Render</b><p>Build the slide at its native canvas size.</p></article><article><span>02</span><b>Measure</b><p>Read the real browser DOM and computed styles.</p></article><article><span>03</span><b>Generate</b><p>Create editable PowerPoint objects, not flattened screenshots.</p></article><article><span>04</span><b>Repair</b><p>Correct OOXML for RTL, fonts, gradients, and glyph drift.</p></article></div>
        <div className="big-claim">What users approve in the browser becomes what they receive in PowerPoint.</div>
        <Next>Reliable delivery is only one part of the system</Next>
      </Slide>

      <Slide number={14}>
        <h2>Improve the decks organizations already own</h2>
        <div className="workflow"><div className="flow-card"><small>ENHANCE</small><h3>Upgrade the deck.<br />Keep the message.</h3><p>Upload a PDF or PowerPoint, apply a saved brand kit, then rebuild each slide professionally while preserving the source content.</p></div><div className="flow-line"><span>Source deck</span><b>→</b><span>Content extraction</span><b>→</b><span>Brand system</span><b>→</b><span>Rebuilt PPTX</span></div></div>
        <Next>Sometimes the content is right, but the desired visual language lives elsewhere</Next>
      </Slide>

      <Slide number={15} tone="mint">
        <h2>Learn a visual language from a reference</h2>
        <div className="workflow"><div className="flow-card"><small>MIMIC</small><h3>Learn the system.<br />Apply it to new content.</h3><p>A reference deck defines the visual logic. Taqreer carries that logic into a new presentation without copying the original content.</p></div><div className="mimic-grid"><article><small>INPUT A</small><b>New content</b><p>Text, file, or structured brief</p></article><article><small>INPUT B</small><b>Reference design</b><p>PDF or PowerPoint</p></article><article className="output"><small>OUTPUT</small><b>A new editable deck</b><p>New narrative, learned visual system</p></article></div></div>
        <Next>Generation becomes useful when the user and the system can still correct the work</Next>
      </Slide>

      <Slide number={16}>
        <h2>Give the AI eyes, then let it repair what it produced</h2>
        <div className="review-loop"><article><span>1</span><b>Render</b><p>Produce the actual slides.</p></article><i>→</i><article><span>2</span><b>See</b><p>Inspect rendered output visually.</p></article><i>→</i><article><span>3</span><b>Audit</b><p>Check RTL, spacing, hierarchy, and overflow.</p></article><i>→</i><article><span>4</span><b>Revise</b><p>Edit failed slides and render again.</p></article></div>
        <div className="callout">Autonomous visual review turns generation into a quality-controlled loop.</div>
        <Next>Human judgment remains essential where culture is visual</Next>
      </Slide>

      <Slide number={17} tone="mint">
        <h2>Generated imagery must respect each Gulf culture</h2>
        <div className="culture-grid"><div><p className="eyebrow">Country-aware prompting</p><h3>Saudi is not Emirati.<br />Emirati is not Omani.</h3><p>Country-specific wardrobe, headwear, formality, gender, architecture, and scene rules, plus negative constraints that prevent mixed national signatures.</p></div><div className="culture-cards"><article><span>SA</span><b>Saudi context</b><small>Wardrobe · setting · formality</small></article><article><span>AE</span><b>Emirati context</b><small>Wardrobe · setting · formality</small></article><article><span>OM</span><b>Omani context</b><small>Wardrobe · setting · formality</small></article></div></div>
        <div className="bridge">This is a natural hybrid checkpoint: AI generates, regional experts verify.</div>
      </Slide>

      <Section number={18} index={5} title="Market signal" subtitle="Early demand concentrated exactly where the thesis points" tone="mint" />

      <Slide number={19} tone="mint">
        <h2>The first users were already concentrated in the Gulf</h2>
        <div className="signal-grid"><div className="metrics vertical"><Metric value="540" label="registered users" /><Metric value="6" label="active subscriptions in the production snapshot" /><Metric value="3" label="months from first user to this snapshot" /></div><div className="demand"><p className="eyebrow">Production signal</p><h3>Demand concentrated in Saudi Arabia and the Gulf within the first weeks of launch.</h3><div><b>Saudi Arabia</b><span style={{ width: "100%" }} /><b>Oman</b><span style={{ width: "53%" }} /><b>UAE and Bahrain</b><span style={{ width: "18%" }} /></div><small>Strongest observed demand came from Saudi Arabia and Oman.</small></div></div>
        <Next>The product has signal, and Tendem has the operating model to scale its quality</Next>
      </Slide>

      <Section number={20} index={6} title="Why Tendem and Toloka" subtitle="The right model for turning regional judgment into reliable finished work" />

      <Slide number={21}>
        <h2>Tendem is already solving the last-mile problem</h2>
        <div className="tendem-metrics"><Metric value="74.5%" label="high-quality results across 94 business tasks" /><Metric value="53%" label="faster median delivery than the human-only baseline" /><Metric value="10K+" label="vetted experts available to the workflow" /></div>
        <div className="thesis"><article><small>AI</small><b>Speed and orchestration</b><p>Break down tasks, execute repeatable steps, and connect the tools.</p></article><span>+</span><article><small>HUMAN EXPERT</small><b>Context and judgment</b><p>Review the high-risk details where pure AI remains brittle.</p></article><span>=</span><article><small>TENDEM</small><b>Finished work</b><p>Verified, business-ready output that the user does not need to clean up.</p></article></div>
        <p className="source">Sources: Tendem performance benchmark and tendem.ai, accessed August 2026.</p>
        <Next>GCC presentation work fits this model almost perfectly</Next>
      </Slide>

      <Slide number={22} tone="gold">
        <h2>Taqreer can become a specialized GCC workflow inside Tendem</h2>
        <div className="fit-flow"><article><small>01</small><b>Tendem plans</b><p>Understand the brief, audience, files, and deliverables.</p></article><article><small>02</small><b>Taqreer produces</b><p>Generate, enhance, mimic, and export the presentation.</p></article><article><small>03</small><b>Experts verify</b><p>Review Arabic, cultural context, institutional tone, and brand accuracy.</p></article><article><small>04</small><b>Visual QA repairs</b><p>Render, audit, revise, and confirm the editable PowerPoint.</p></article><article><small>05</small><b>Tendem delivers</b><p>A bilingual deck ready for a GCC boardroom.</p></article></div>
        <div className="bridge">A product system, an expert gate, and a clear regional market.</div>
      </Slide>

      <Slide number={23}>
        <h2>I built and funded Taqreer alone. Tendem is where its learning can reach a team and a market.</h2>
        <div className="merge-grid"><article><p className="eyebrow">Built independently</p><b>I designed, built, operated, and financed the product myself in my free time.</b><p>API usage, hosting, Supabase, and production infrastructure came from my own money. I am now unemployed, and continuing alone is not sustainable.</p></article><article><p className="eyebrow">Why join Tendem and Toloka</p><b>Your hybrid model matches what the GCC actually needs: AI speed with accountable regional judgment.</b><p>I want to be part of the team and explore bringing Taqreer&apos;s technology, product learning, and GCC specialization into Tendem.</p></article></div>
        <div className="bridge">Taqreer proves what I can build. Tendem provides the model to make it reliably useful at scale.</div>
      </Slide>

      <Section number={24} index={7} title="What I bring" subtitle="Regional judgment translated into product, expert workflows, and growth" tone="gold" />

      <Slide number={25} tone="gold">
        <h2>12 years of regional context, translated into product judgment</h2>
        <div className="contribution"><article><small>GCC MARKET</small><b>How government and enterprise buyers evaluate quality</b><b>How regional brands signal credibility</b><b>Where bilingual content fails in real workflows</b><b>How institutions buy, review, and deliver PowerPoint</b></article><article><small>PRODUCT AND CREATIVE</small><b>Arabic and BiDi product direction</b><b>Regional positioning and visual narrative</b><b>Culturally precise image systems</b><b>Turning expert judgment into repeatable acceptance criteria</b></article><article><small>BUILDER MINDSET</small><b>End-to-end product design and implementation</b><b>Agentic generation and visual QA</b><b>Production SaaS operations</b><b>GCC launch and growth direction</b></article></div>
        <div className="bridge">I can connect the regional expert, the product system, and the buyer.</div>
      </Slide>

      <Slide number={26} tone="gold">
        <h2>New Tendem capabilities the GCC market can benefit from</h2>
        <div className="opportunity-grid"><article><span>01</span><b>GCC Presentation Task</b><p>Research, write, design, verify, and deliver an institution-ready bilingual deck.</p></article><article><span>02</span><b>Arabic PowerPoint QA Gate</b><p>Expert review for RTL, mixed scripts, fonts, charts, and editable export.</p></article><article><span>03</span><b>Country-aware Creative Review</b><p>Human verification of wardrobe, culture, imagery, tone, and national context.</p></article><article><span>04</span><b>Enterprise Brand Operations</b><p>Turn approved guidelines and source files into consistent Arabic deliverables at scale.</p></article></div>
        <div className="bridge">A new regional service category built on Tendem&apos;s existing strengths.</div>
      </Slide>

      <Slide number={27}>
        <div className="closing"><p className="eyebrow">The next step</p><h2>If you are interested,<br />let&apos;s have a conversation.</h2><p>I would love to discuss how my GCC knowledge, Taqreer&apos;s technology, and product design experience could contribute to Tendem and Toloka.</p><button onClick={() => deck.current?.querySelectorAll(".slide")[0]?.scrollIntoView({ behavior: "smooth" })}>Return to the beginning ↑</button></div>
      </Slide>
    </main>
  );
}
