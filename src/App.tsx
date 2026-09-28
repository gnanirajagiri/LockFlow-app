import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui/Toast';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './auth/LoginPage';
import { HomePage } from './pages/HomePage';
import { CreatePage } from './pages/CreatePage';
import { ModelsPage } from './pages/ModelsPage';
import { EnvironmentsPage } from './pages/EnvironmentsPage';
import { EnvironmentProfileLayout } from './features/environments/EnvironmentProfileLayout';
import {
  EnvironmentEditRoute,
  EnvironmentOverviewRoute,
  EnvironmentReferencesRoute,
  EnvironmentSpecsRoute,
  EnvironmentVersionsRoute,
} from './features/environments/tabRoutes';
import { EnvironmentLockPage } from './features/environments/EnvironmentLockPage';
import { StudioPage } from './pages/StudioPage';
import { ContentStudioPage } from './pages/ContentStudioPage';
import { ContentStudioNewPlanPage } from './pages/ContentStudioNewPlanPage';
import { ContentProjectDetailPage } from './pages/ContentProjectDetailPage';
import { ContentProjectLayout } from './features/content/ContentProjectLayout';
import {
  ContentBriefRoute,
  ContentInputsRoute,
  ContentJobRoute,
  ContentReviewRoute,
  ContentStoryboardRoute,
} from './features/content/tabRoutes';
import { TemplatesHomePage } from './features/templates/TemplatesHomePage';
import { TemplateCreatePage } from './features/templates/TemplateCreatePage';
import { TemplateEditPage } from './features/templates/TemplateEditPage';
import { TemplateDetailPage } from './features/templates/TemplateDetailPage';
import { TemplateApplyPage } from './features/templates/TemplateApplyPage';
import { GalleryPage } from './pages/GalleryPage';
import { GalleryOutputDetailPage } from './pages/GalleryOutputDetailPage';
import { GalleryCollectionsPage } from './pages/GalleryCollectionsPage';
import { GalleryCollectionDetailPage } from './pages/GalleryCollectionDetailPage';
import { GalleryQualityReviewPage } from './features/quality/GalleryQualityReviewPage';
import { CorrectionCreatePage } from './features/quality/CorrectionCreatePage';
import { CorrectionsPage } from './features/quality/CorrectionsPage';
import { CorrectionDetailPage } from './features/quality/CorrectionDetailPage';
import { LibraryPage } from './pages/LibraryPage';
import { LibraryNewAssetPage } from './pages/LibraryNewAssetPage';
import { LibraryLooksPage } from './pages/LibraryLooksPage';
import { LibraryNewLookPage } from './pages/LibraryNewLookPage';
import { LibraryLookProfilePage } from './pages/LibraryLookProfilePage';
import { LibraryAssetProfileLayout } from './features/library/LibraryAssetProfileLayout';
import {
  LibraryDetailsRoute,
  LibraryOverviewRoute,
  LibraryReferencesRoute,
  LibraryVersionsRoute,
} from './features/library/tabRoutes';
import { CampaignsPage } from './pages/CampaignsPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ModelProfileLayout } from './features/models/ModelProfileLayout';
import {
  ModelCharacterSheetRoute,
  ModelClosetPropsRoute,
  ModelLooksRoute,
  ModelOverviewRoute,
  ModelUsageHistoryRoute,
  ModelVersionsRoute,
} from './features/models/tabRoutes';

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
              <Route path="environments" element={<EnvironmentsPage />} />
              <Route path="environments/:environmentId/lock" element={<EnvironmentLockPage />} />
              <Route path="environments/:environmentId" element={<EnvironmentProfileLayout />}>
                <Route index element={<EnvironmentOverviewRoute />} />
                <Route path="edit" element={<EnvironmentEditRoute />} />
                <Route path="references" element={<EnvironmentReferencesRoute />} />
                <Route path="versions" element={<EnvironmentVersionsRoute />} />
                <Route path="specs" element={<EnvironmentSpecsRoute />} />
              </Route>
              <Route path="models/:modelId" element={<ModelProfileLayout />}>
                <Route index element={<ModelOverviewRoute />} />
                <Route path="character-sheet" element={<ModelCharacterSheetRoute />} />
                <Route path="versions" element={<ModelVersionsRoute />} />
                <Route path="looks" element={<ModelLooksRoute />} />
                <Route path="closet-props" element={<ModelClosetPropsRoute />} />
                <Route path="usage-history" element={<ModelUsageHistoryRoute />} />
              </Route>
              <Route path="studio" element={<StudioPage />} />
              <Route path="content-studio" element={<ContentStudioPage />} />
              <Route path="content-studio/new" element={<ContentStudioNewPlanPage />} />
              <Route path="content-studio/:projectId" element={<ContentProjectLayout />}>
                <Route index element={<ContentProjectDetailPage />} />
                <Route path="brief" element={<ContentBriefRoute />} />
                <Route path="inputs" element={<ContentInputsRoute />} />
                <Route path="storyboard" element={<ContentStoryboardRoute />} />
                <Route path="review" element={<ContentReviewRoute />} />
                <Route path="job" element={<ContentJobRoute />} />
              </Route>
              <Route path="templates" element={<TemplatesHomePage />} />
              <Route path="templates/new" element={<TemplateCreatePage />} />
              <Route path="templates/:templateId" element={<TemplateDetailPage />} />
              <Route path="templates/:templateId/edit" element={<TemplateEditPage />} />
              <Route path="templates/:templateId/apply" element={<TemplateApplyPage />} />
              <Route path="gallery" element={<GalleryPage />} />
              <Route path="gallery/collections" element={<GalleryCollectionsPage />} />
              <Route path="gallery/collections/:collectionId" element={<GalleryCollectionDetailPage />} />
              <Route path="gallery/:outputId" element={<GalleryOutputDetailPage />} />
              <Route path="gallery/:outputId/quality" element={<GalleryQualityReviewPage />} />
              <Route path="gallery/:outputId/corrections" element={<CorrectionCreatePage />} />
              <Route path="corrections" element={<CorrectionsPage />} />
              <Route path="corrections/:correctionRequestId" element={<CorrectionDetailPage />} />
              <Route path="library" element={<LibraryPage />} />
              <Route path="library/new" element={<LibraryNewAssetPage />} />
              <Route path="library/looks" element={<LibraryLooksPage />} />
              <Route path="library/looks/new" element={<LibraryNewLookPage />} />
              <Route path="library/looks/:assetId" element={<LibraryLookProfilePage />} />
              <Route path="library/:assetId" element={<LibraryAssetProfileLayout />}>
                <Route index element={<LibraryOverviewRoute />} />
                <Route path="details" element={<LibraryDetailsRoute />} />
                <Route path="references" element={<LibraryReferencesRoute />} />
                <Route path="versions" element={<LibraryVersionsRoute />} />
              </Route>
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
