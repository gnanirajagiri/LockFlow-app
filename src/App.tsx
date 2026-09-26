import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui/Toast';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './auth/LoginPage';
import { HomePage } from './pages/HomePage';
import { CreatePage } from './pages/CreatePage';
import { ModelsPage } from './pages/ModelsPage';
import { StudioPage } from './pages/StudioPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { GalleryPage } from './pages/GalleryPage';
import { LibraryPage } from './pages/LibraryPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';
import { NotFoundPage } from './pages/NotFoundPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              <Route index element={<HomePage />} />
              <Route path="create" element={<CreatePage />} />
              <Route path="models" element={<ModelsPage />} />
              <Route path="studio" element={<StudioPage />} />
              <Route path="templates" element={<TemplatesPage />} />
              <Route path="gallery" element={<GalleryPage />} />
              <Route path="library" element={<LibraryPage />} />
              <Route path="campaigns" element={<CampaignsPage />} />
              <Route path="workspace" element={<WorkspacePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="help" element={<HelpPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
