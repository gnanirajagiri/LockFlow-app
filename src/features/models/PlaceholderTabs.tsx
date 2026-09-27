/**
 * Route-aware placeholder panels for Looks, Closet & Props and Usage
 * history. Each explains what will live here without creating records:
 * Looks connect to the shared Library, Closet & Props are shortcuts into
 * that one shared Library, and generated outputs stay in Gallery.
 */
import { Link } from 'react-router-dom';
import { Card, CardBody } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { LibraryIcon, GalleryIcon, SparkIcon } from '../../components/icons';

export function LooksTab() {
  return (
    <div className="lf-section">
      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>Looks</h3>
            <p className="lf-tile__description">
              Looks are reusable combinations of wardrobe and accessories — quick, consistent
              styling layers for a model. They never change the model's identity.
            </p>
            <p className="lf-tile__description">
              <strong>Looks will connect to the shared Library next.</strong>
            </p>
          </div>
        </CardBody>
      </Card>
      <EmptyState
        borderless
        icon={<SparkIcon size={22} />}
        title="No saved looks yet"
        description="Saved Looks will appear here once Looks connect to the shared Library. No asset records are created in this view."
      />
    </div>
  );
}

export function ClosetPropsTab() {
  return (
    <div className="lf-section">
      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>Closet &amp; Props</h3>
            <p className="lf-tile__description">
              These are quick-access shortcuts to reusable items in the one shared Library —
              wardrobe pieces, accessories, props and products. Shortcuts point at Library
              assets; they never duplicate them into a separate model library.
            </p>
            <p className="lf-tile__description">
              <strong>Manage shared assets in Library.</strong>
            </p>
            <div className="lf-modelprofile__actions-row" style={{ justifyContent: 'flex-start' }}>
              <Link className="lf-btn lf-btn--secondary lf-btn--sm" to="/library">
                <span className="lf-btn__icon" aria-hidden="true">
                  <LibraryIcon size={14} />
                </span>
                Open Library
              </Link>
            </div>
          </div>
        </CardBody>
      </Card>
      <EmptyState
        borderless
        icon={<LibraryIcon size={22} />}
        title="No shortcuts yet"
        description="Shortcut assets will appear here once the shared Library lands. Nothing is stored on the model itself."
      />
    </div>
  );
}

export function UsageHistoryTab() {
  return (
    <div className="lf-section">
      <Card>
        <CardBody>
          <div className="lf-sheet__section">
            <h3>Usage history</h3>
            <p className="lf-tile__description">
              Generated outputs remain in Gallery — this panel only ever shows a lightweight
              historical summary of where this model's identity was used. No content-job
              records are created here.
            </p>
          </div>
        </CardBody>
      </Card>
      <EmptyState
        borderless
        icon={<GalleryIcon size={22} />}
        title="No usage recorded yet"
        description="Once content jobs run, a summary of generated outputs that used this model will appear here."
        actions={
          <span
            className="lf-btn lf-btn--secondary lf-btn--sm"
            aria-disabled="true"
            style={{ opacity: 0.55, cursor: 'not-allowed' }}
            title="Gallery opens in a later milestone"
          >
            <span className="lf-btn__icon" aria-hidden="true">
              <GalleryIcon size={14} />
            </span>
            Open Gallery
          </span>
        }
      />
    </div>
  );
}
