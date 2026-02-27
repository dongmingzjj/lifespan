import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
      <div className="text-center">
        <h1 className="text-9xl font-bold text-primary-600 dark:text-primary-400">404</h1>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-4">
          Page not found
        </h2>
        <p className="text-slate-600 dark:text-slate-400 mt-2 mb-6">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Button variant="primary" size="md" onClick={() => navigate('/')}>
          Go back home
        </Button>
      </div>
    </div>
  );
}
