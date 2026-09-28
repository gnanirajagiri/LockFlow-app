/**
 * Route wrappers for the Content Studio project tabs.
 */
import { useOutletContext } from 'react-router-dom';
import { BriefTab } from './BriefTab';
import { InputsTab } from './InputsTab';
import { StoryboardTab } from './StoryboardTab';
import { ReviewTab } from './ReviewTab';
import { JobTab } from './JobTab';
import type { ContentProjectOutletContext } from './ContentProjectLayout';

export function useContentProjectOutletContext(): ContentProjectOutletContext {
  return useOutletContext<ContentProjectOutletContext>();
}

export function ContentBriefRoute() {
  return <BriefTab />;
}

export function ContentInputsRoute() {
  return <InputsTab />;
}

export function ContentStoryboardRoute() {
  return <StoryboardTab />;
}

export function ContentReviewRoute() {
  return <ReviewTab />;
}

export function ContentJobRoute() {
  return <JobTab />;
}
