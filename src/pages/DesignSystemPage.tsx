/**
 * /design-system — the DS-02 "Components & variants" sheet rendered live.
 *
 * A single gallery page of the app's real UI primitives (Buttons, Inputs,
 * Badges/chips/tabs, Prompt bar/Stepper/Progress, Cards, Feedback, Modal,
 * Empty state) so designers and engineers compare implementation against the
 * board in one place. Static showcase — no data loads, no side effects.
 */
import { useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import {
  AlertIcon,
  CheckIcon,
  CloseIcon,
  ImageIcon,
  InfoIcon,
  LockIcon,
  SparkIcon,
} from '../components/icons';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardBody>
        <h2 className="lf-ds__h2">{title}</h2>
        <div className="lf-ds__stack">{children}</div>
      </CardBody>
    </Card>
  );
}

export function DesignSystemPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  const [toggleOn, setToggleOn] = useState(true);
  const [slider, setSlider] = useState(68);

  return (
    <div className="lf-ds">
      <PageHeader
        eyebrow="LockFlow · DS-02"
        title="Components & variants"
        description="The live component library — every element below is the real primitive used across the app."
      />

      <div className="lf-ds__grid">
        <Section title="Buttons">
          <div className="lf-ds__row">
            <Button variant="primary">Primary</Button>
            <Button variant="primary" leftIcon={<SparkIcon size={14} />}>Generate</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger" leftIcon={<CloseIcon size={14} />}>Delete</Button>
          </div>
          <div className="lf-ds__row">
            <Button variant="primary" disabled>Disabled</Button>
          </div>
          <div className="lf-ds__row">
            <Button variant="primary" size="lg">Large CTA</Button>
            <Button variant="secondary" size="sm">Small</Button>
            <Button variant="primary" size="sm">Small primary</Button>
            <button type="button" className="lf-btn lf-btn--danger lf-ds__outlinebtn">Destructive outline</button>
          </div>
          <div>
            <p className="lf-ds__overline">Credit-bearing CTA</p>
            <div className="lf-ds__row">
              <button type="button" className="lf-btn lf-btn--primary lf-btn--lg lf-ds__gradientbtn">
                <SparkIcon size={14} /> Generate draft · 8 credits
              </button>
              <button type="button" className="lf-btn lf-btn--primary lf-btn--lg">
                <LockIcon size={14} /> Lock model · creates Aria v1
              </button>
            </div>
          </div>
        </Section>

        <Section title="Inputs & selection">
          <div className="lf-ds__cols">
            <Input label="Name" value="Aria" readOnly />
            <Input label="Email" type="email" placeholder="you@studio.com" />
          </div>
          <div className="lf-ds__cols">
            <div className="lf-ds__errorfield">
              <Input label="Password" type="password" defaultValue="password" />
              <p className="lf-field__error">Email or password is incorrect.</p>
            </div>
            <div className="lf-ds__aifield">
              <span className="lf-ds__lablerow">Colours <Badge tone="primary">AI suggested ✓</Badge></span>
              <div className="lf-input lf-ds__aibox">Cream, oat</div>
            </div>
          </div>
          <div className="lf-ds__row lf-ds__controls">
            <label className="lf-ds__check">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              Checked
            </label>
            <label className="lf-ds__check">
              <input type="checkbox" /> Unchecked
            </label>
            <label className="lf-ds__check">
              <input type="radio" name="ds-radio" defaultChecked /> Selected
            </label>
            <label className="lf-ds__check">
              <input type="checkbox" role="switch" checked={toggleOn} onChange={(e) => setToggleOn(e.target.checked)} />
              {toggleOn ? 'On' : 'Off'}
            </label>
            <input
              className="lf-ds__slider"
              type="range"
              min={0}
              max={100}
              value={slider}
              onChange={(e) => setSlider(Number(e.target.value))}
              aria-label="Strength"
            />
          </div>
        </Section>

        <Section title="Chips, badges, tabs">
          <div className="lf-ds__row">
            <button type="button" className="lf-ds__chip lf-ds__chip--on">All</button>
            <button type="button" className="lf-ds__chip">Wardrobe</button>
            <button type="button" className="lf-ds__chip">Props</button>
            <button type="button" className="lf-ds__chip lf-ds__chip--ai"><SparkIcon size={12} /> AI suggestion</button>
            <button type="button" className="lf-ds__chip">Stand</button>
          </div>
          <div className="lf-ds__row">
            <Badge tone="locked"><LockIcon size={11} /> Aria v1 · Locked</Badge>
            <Badge tone="primary">v2 · Draft</Badge>
            <Badge tone="success"><CheckIcon size={11} /> 97%</Badge>
            <Badge tone="warning">81%</Badge>
            <Badge tone="info">Required</Badge>
            <Badge tone="locked"><LockIcon size={11} /> Locked</Badge>
          </div>
          <div className="lf-ds__tabs" role="tablist" aria-label="Example tabs">
            <button type="button" role="tab" aria-selected className="lf-ds__tab lf-ds__tab--on">In progress <span className="lf-ds__tabcount">3</span></button>
            <button type="button" role="tab" className="lf-ds__tab">Drafts <span className="lf-ds__tabcount">5</span></button>
            <button type="button" role="tab" className="lf-ds__tab">Exports <span className="lf-ds__tabcount">24</span></button>
            <button type="button" role="tab" className="lf-ds__tab">Failed <span className="lf-ds__tabcount">1</span></button>
          </div>
          <div className="lf-ds__segment" role="group" aria-label="Segmented example">
            <button type="button" className="lf-ds__segmentbtn">One more</button>
            <button type="button" className="lf-ds__segmentbtn">Variants</button>
            <button type="button" className="lf-ds__segmentbtn">Photo</button>
            <button type="button" className="lf-ds__segmentbtn lf-ds__segmentbtn--on">Video</button>
            <button type="button" className="lf-ds__segmentbtn">Story</button>
          </div>
        </Section>

        <Section title="Prompt bar · Stepper · Progress">
          <div className="lf-ds__promptbar">
            <SparkIcon size={16} />
            <input
              className="lf-ds__promptinput"
              placeholder='Describe a change — e.g. "warmer golden-hour light, add a eucalyptus vase"'
              aria-label="Prompt"
            />
            <button type="button" className="lf-ds__prompticon" aria-label="Attach image"><ImageIcon size={16} /></button>
            <Button variant="primary" size="sm" leftIcon={<SparkIcon size={12} />}>Generate</Button>
          </div>
          <ol className="lf-ds__stepper">
            <li className="lf-ds__step lf-ds__step--done"><span className="lf-ds__stepdot"><CheckIcon size={11} /></span> Start</li>
            <li className="lf-ds__step lf-ds__step--done"><span className="lf-ds__stepdot"><CheckIcon size={11} /></span> Look</li>
            <li className="lf-ds__step lf-ds__step--current"><span className="lf-ds__stepdot">3</span> Fine details</li>
            <li className="lf-ds__step lf-ds__step--optional">(optional) — <span className="lf-ds__stepdot lf-ds__stepdot--ghost">4</span> Style</li>
            <li className="lf-ds__step"><span className="lf-ds__stepdot lf-ds__stepdot--ghost">5</span> Character Sheet</li>
            <li className="lf-ds__step"><span className="lf-ds__stepdot lf-ds__stepdot--ghost">6</span> Lock & Save</li>
          </ol>
          <div className="lf-ds__progress">
            <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-label={`${slider}% complete`}>
              <circle cx="20" cy="20" r="16" fill="none" stroke="var(--lf-color-border)" strokeWidth="3.5" />
              <circle
                cx="20" cy="20" r="16" fill="none" stroke="var(--lf-color-primary)" strokeWidth="3.5" strokeLinecap="round"
                strokeDasharray={`${(slider / 100) * 2 * Math.PI * 16} ${2 * Math.PI * 16}`}
                transform="rotate(-90 20 20)"
              />
              <text x="20" y="24" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--lf-color-ink)">{slider}%</text>
            </svg>
            <div className="lf-ds__progressbar">
              <div className="lf-ds__progressfill" style={{ width: `${slider}%` }} />
            </div>
          </div>
        </Section>

        <Section title="Cards">
          <div className="lf-ds__cards">
            <div className="lf-ds__mediacard">
              <div className="lf-ds__media">
                <img src="/placeholders/gallery/gallery_morning_routine_variant.svg" alt="" loading="lazy" />
                <span className="lf-ds__mediabadge lf-ds__mediabadge--dark"><LockIcon size={11} /> v1 · Locked</span>
              </div>
              <div className="lf-ds__mediabody">
                <strong>Aria</strong>
                <span className="lf-tile__description">17 jobs · 4 campaigns</span>
              </div>
            </div>
            <div className="lf-ds__mediacard">
              <div className="lf-ds__media">
                <img src="/placeholders/gallery/gallery_serum_product_moment.svg" alt="" loading="lazy" />
                <span className="lf-ds__mediabadge lf-ds__mediabadge--success"><CheckIcon size={11} /> Approved</span>
              </div>
              <div className="lf-ds__mediabody">
                <strong>Glow Serum 30ml</strong>
                <span className="lf-tile__description">Products</span>
              </div>
            </div>
            <div className="lf-ds__mediacard lf-ds__mediacard--warning">
              <div className="lf-ds__media">
                <img src="/placeholders/gallery/gallery_morning_vanity_setup-thumb.svg" alt="" loading="lazy" />
                <span className="lf-ds__mediabadge lf-ds__mediabadge--warning">Needs review</span>
              </div>
              <div className="lf-ds__mediabody">
                <strong>Serum review</strong>
                <span className="lf-tile__description">Expires in 27 days</span>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Feedback">
          <div className="lf-alertbox lf-ds__note lf-ds__note--info" role="status">
            <InfoIcon size={14} /> Temporary settings aren't locked, so results may vary between scenes.
          </div>
          <div className="lf-alertbox lf-ds__note lf-ds__note--warning" role="status">
            <AlertIcon size={14} /> Scene 2 · product label slightly blurred.
          </div>
          <div className="lf-alertbox lf-ds__note lf-ds__note--danger" role="status">
            <AlertIcon size={14} /> Final render failed — your 20 credits were refunded.
          </div>
          <div className="lf-alertbox lf-ds__note lf-ds__note--success" role="status">
            <CheckIcon size={14} /> Aria v1 is locked.
          </div>
          <div className="lf-ds__row">
            <Skeleton width={64} height={64} />
            <div className="lf-ds__skeletonstack">
              <Skeleton width={420} height={12} />
              <Skeleton width={320} height={12} />
            </div>
          </div>
        </Section>

        <Section title="Modal">
          <p className="lf-tile__description">Confirmation pattern with a primary keep-action and a neutral escape.</p>
          <Button variant="primary" onClick={() => setModalOpen(true)}>Open example modal</Button>
        </Section>

        <Section title="Drawer">
          <div className="lf-ds__drawer">
            <Skeleton width={140} height={120} />
            <div className="lf-ds__skeletonstack">
              <strong>Add from Library</strong>
              <Skeleton width={200} height={10} />
              <Skeleton width={160} height={10} />
            </div>
          </div>
        </Section>

        <Section title="Empty state">
          <EmptyState
            icon={<ImageIcon size={20} />}
            title="Nothing here yet"
            description="Everything you generate appears here."
            actions={<Button variant="primary">Create content</Button>}
          />
        </Section>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Hair texture is locked in Aria v1"
        description="Choose how to continue."
        size="sm"
        footer={
          <div className="lf-dialogactions">
            <Button variant="primary" onClick={() => setModalOpen(false)}>Keep it locked</Button>
            <Button onClick={() => setModalOpen(false)}>Create v2 draft</Button>
          </div>
        }
      >
        <p className="lf-tile__description">
          Locked identity traits are read-only. Creating a v2 draft copies the sheet and lets you
          revise freely — v1 stays exactly as locked.
        </p>
      </Modal>
    </div>
  );
}
