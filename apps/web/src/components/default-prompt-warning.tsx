import { AlertTriangle } from 'lucide-react';

export function DefaultPromptWarning({
  profileName,
  promptName,
  onCancel,
  onContinue,
  continueLabel = 'Generate anyway',
}: {
  profileName: string;
  promptName: string;
  onCancel: () => void;
  onContinue: () => void;
  continueLabel?: string;
}) {
  return (
    <>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-amber-50 p-2 text-amber-600">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-800">No prompt assigned to this profile</h3>
          <p className="text-sm text-slate-600 mt-1">
            <span className="font-medium text-slate-800">{profileName || 'This profile'}</span> has no
            assigned prompt. Generation will use the default prompt
            {promptName ? (
              <>
                {' '}
                <span className="font-medium text-slate-800">{promptName}</span>
              </>
            ) : null}
            .
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-slate-700 border border-[var(--border)] rounded-lg hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onContinue}
          className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light"
        >
          {continueLabel}
        </button>
      </div>
    </>
  );
}
