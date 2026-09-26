import { Navigate } from 'react-router-dom';

/**
 * Redirect helper used by LoginPage after authentication.
 * Exists as its own module so auth modules can import router primitives
 * without creating circular imports with the app shell.
 */
export function LocationHackAvoider({
  to,
  replace,
}: {
  to: string;
  replace?: boolean;
}) {
  return <Navigate to={to} replace={replace} />;
}
