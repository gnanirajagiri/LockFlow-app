import { Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui/Toast';
import { AppShell } from './components/layout/AppShell';
import { CampaignActivityTab, CampaignCalendarTab, CampaignChannelsTab, CampaignContentTab, CampaignCreatePage, CampaignLayout, CampaignOverviewTab, CampaignPublishingCalendarPage, CampaignPublishingPage, CampaignStatusOverviewPage, CampaignsHomePage, ConnectionCallbackPage, ConnectionStartPage, ConnectionsPage, ContentBriefRoute, ContentComposeRoute, ContentInputsRoute, ContentJobRoute, ContentProjectDetailPage, ContentProjectLayout, ContentReviewRoute, ContentStoryboardRoute, ContentStudioNewPlanPage, ContentStudioPage, CorrectionCreatePage, CorrectionDetailPage, CorrectionsPage, CreateDraftsPage, CreatePage, EnvironmentBuilderRoute, EnvironmentEditRoute, EnvironmentLockPage, EnvironmentOverviewRoute, EnvironmentProfileLayout, EnvironmentReferencesRoute, EnvironmentSpecsRoute, EnvironmentVersionsRoute, EnvironmentsPage, GalleryCollectionDetailPage, GalleryCollectionsPage, GalleryOutputDetailPage, GalleryPage, GalleryQualityReviewPage, HelpPage, HomePage, LibraryAddAssetPage, LibraryArchivedPage, LibraryAssetEditPage, LibraryAssetOpsDetailPage, LibraryAssetProfileLayout, LibraryAssetsPage, LibraryDetailsRoute, LibraryLookProfilePage, LibraryLooksPage, LibraryNewAssetPage, LibraryNewLookPage, LibraryOpsHomePage, LibraryOverviewRoute, LibraryPickerPage, LibraryReferencesRoute, LibraryVersionsRoute, LoginPage, ModelBuilderRoute, ModelCharacterSheetRoute, ModelClosetPropsRoute, ModelLooksRoute, ModelOverviewRoute, ModelProfileLayout, ModelUsageHistoryRoute, ModelVersionsRoute, ModelsPage, NotFoundPage, ProtectedRoute, PublishRunDetailOpsPage, PublishingCreatePage, PublishingDetailPage, PublishingGlobalListPage, PublishingHistoryPage, PublishingReviewPage, PublishingRunDetailPage, DesignSystemPage, SettingsPage, StudioPage, TemplateApplyPage, TemplateCreatePage, TemplateDetailPage, TemplateEditPage, TemplatesHomePage, WorkspacePage } from './routes';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<div className="lf-content" aria-busy="true" />}>
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
              <Route path="create/drafts" element={<CreateDraftsPage />} />
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
                <Route path="compose" element={<ContentComposeRoute />} />
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
              <Route path="design-system" element={<DesignSystemPage />} />
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
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
