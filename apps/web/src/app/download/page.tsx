import type { Metadata } from 'next';
import { DesktopDownload } from '@/components/desktop-download';

export const metadata: Metadata = {
  title: 'Download for Windows | AnchorProposal',
  description: 'Download the portable AnchorProposal Windows app. Your resumes and application answers, one shortcut away.',
};

export default function DownloadPage() {
  return <DesktopDownload />;
}
