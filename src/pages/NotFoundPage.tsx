import { PageHeader } from '../components/layout/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';
import { useNavigate } from 'react-router-dom';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div className="lf-page">
      <PageHeader title="Page not found" />
      <EmptyState
        title="This page doesn't exist"
        description="The link may be outdated. Head back to Home to find what you were looking for."
        actions={
          <Button variant="primary" onClick={() => navigate('/')}>
            Back to Home
          </Button>
        }
      />
    </div>
  );
}
