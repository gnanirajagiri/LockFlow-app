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
  EnvironmentBuilderRoute,
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
import { ConnectionsPage } from './features/social/ConnectionsPage';
import {
  ConnectionCallbackPage,
  ConnectionStartPage,
} from './features/social/ConnectionCallbackPage';
import { CampaignPublishingPage } from './features/publishing/PublishingHomePage';
import { PublishingCreatePage } from './features/publishing/PublishingCreatePage';
import { PublishingDetailPage } from './features/publishing/PublishingDetailPage';
import { PublishingGlobalListPage } from './features/publishing/PublishingGlobalListPage';
import { PublishingReviewPage } from './features/publishing/PublishingReviewPage';
import { PublishingRunDetailPage } from './features/publishing/PublishingRunDetailPage';
import { CampaignPublishingCalendarPage } from './features/publishing/CampaignPublishingCalendarPage';
import { PublishingHistoryPage } from './features/publishing/PublishingHistoryPage';
import { PublishRunDetailOpsPage } from './features/publishing/PublishRunDetailOpsPage';
import { CampaignStatusOverviewPage } from './features/publishing/CampaignStatusOverviewPage';
import { GalleryQualityReviewPage } from './features/quality/GalleryQualityReviewPage';
import { CorrectionCreatePage } from './features/quality/CorrectionCreatePage';
import { CorrectionsPage } from './features/quality/CorrectionsPage';
import { CorrectionDetailPage } from './features/quality/CorrectionDetailPage';
import { LibraryNewAssetPage } from './pages/LibraryNewAssetPage';
import { LibraryLooksPage } from './pages/LibraryLooksPage';
import { LibraryNewLookPage } from './pages/LibraryNewLookPage';
import { LibraryLookProfilePage } from './pages/LibraryLookProfilePage';
import { LibraryAssetProfileLayout } from './features/library/LibraryAssetProfileLayout';
import { LibraryOpsHomePage } from './features/library/LibraryOpsHomePage';
import { LibraryAssetsPage } from './features/library/LibraryAssetsPage';
import { LibraryAssetOpsDetailPage } from './features/library/LibraryAssetOpsDetailPage';
import { LibraryPickerPage } from './features/library/LibraryPickerPage';
import { LibraryArchivedPage } from './features/library/LibraryArchivedPage';
import { LibraryAddAssetPage } from './features/library/LibraryAddAssetPage';
import { LibraryAssetEditPage } from './features/library/LibraryAssetEditPage';
import {
  LibraryDetailsRoute,
  LibraryOverviewRoute,
  LibraryReferencesRoute,
  LibraryVersionsRoute,
} from './features/library/tabRoutes';
import { CampaignsHomePage } from './features/campaigns/CampaignsHomePage';
import { CampaignCreatePage } from './features/campaigns/CampaignCreatePage';
import { CampaignLayout } from './features/campaigns/CampaignLayout';
import { CampaignOverviewTab } from './features/campaigns/CampaignOverviewTab';
import { CampaignContentTab } from './features/campaigns/CampaignContentTab';
import { CampaignCalendarTab } from './features/campaigns/CampaignCalendarTab';
import { CampaignChannelsTab } from './features/campaigns/CampaignChannelsTab';
import { CampaignActivityTab } from './features/campaigns/CampaignActivityTab';
import { WorkspacePage } from './pages/WorkspacePage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ModelProfileLayout } from './features/models/ModelProfileLayout';
import {
  ModelBuilderRoute,
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
                <Route path="builder" element={<EnvironmentBuilderRoute />} />
                <Route path="edit" element={<EnvironmentEditRoute />} />
                <Route path="references" element={<EnvironmentReferencesRoute />} />
                <Route path="versions" element={<EnvironmentVersionsRoute />} />
                <Route path="specs" element={<EnvironmentSpecsRoute />} />
              </Route>
              <Route path="models/:modelId" element={<ModelProfileLayout />}>
                <Route index element={<ModelOverviewRoute />} />
                <Route path="builder" element={<ModelBuilderRoute />} />
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
              <Route path="library" element={<LibraryOpsHomePage />} />
              <Route path="library/assets" element={<LibraryAssetsPage />} />
              <Route path="library/assets/:assetId" element={<LibraryAssetOpsDetailPage />} />
              <Route path="library/assets/:assetId/edit" element={<LibraryAssetEditPage />} />
              <Route path="library/add" element={<LibraryAddAssetPage />} />
              <Route path="library/picker" element={<LibraryPickerPage />} />
              <Route path="library/archived" element={<LibraryArchivedPage />} />
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
              <Route path="campaigns" element={<CampaignsHomePage />} />
              <Route path="campaigns/new" element={<CampaignCreatePage />} />
              <Route path="campaigns/:campaignId" element={<CampaignLayout />}>
                <Route index element={<CampaignOverviewTab />} />
                <Route path="overview" element={<CampaignOverviewTab />} />
                <Route path="content" element={<CampaignContentTab />} />
                <Route path="calendar" element={<CampaignCalendarTab />} />
                <Route path="channels" element={<CampaignChannelsTab />} />
                <Route path="activity" element={<CampaignActivityTab />} />
                <Route path="publishing" element={<CampaignPublishingPage />} />
                <Route path="publishing/new" element={<PublishingCreatePage />} />
                <Route path="publishing-review" element={<PublishingReviewPage />} />
                <Route path="publishing-review/:campaignItemId" element={<PublishingRunDetailPage />} />
                <Route path="calendar" element={<CampaignPublishingCalendarPage />} />
                <Route path="publishing-history" element={<PublishingHistoryPage />} />
                <Route path="publish-runs/:publishRunId" element={<PublishRunDetailOpsPage />} />
                <Route path="status" element={<CampaignStatusOverviewPage />} />
              </Route>
              <Route path="publishing" element={<PublishingGlobalListPage />} />
              <Route path="publishing/:publishingDraftId" element={<PublishingDetailPage />} />
              <Route path="workspace" element={<WorkspacePage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="settings/connections" element={<ConnectionsPage />} />
              <Route
                path="settings/connections/:providerKey/connect"
                element={<ConnectionStartPage />}
              />
              <Route
                path="settings/connections/callback/:providerKey"
                element={<ConnectionCallbackPage />}
              />
              <Route path="help" element={<HelpPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
