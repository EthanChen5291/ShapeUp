import { LegalShell } from '../LegalShell';
import { DeleteAccountPanel } from './DeleteAccountPanel';

export const metadata = {
  title: 'Delete My Data | ShapeUp',
};

export default function DeleteMyDataPage() {
  return (
    <LegalShell
      title="Delete My Data"
      updated="2026-06-08"
      review="PLACEHOLDER - NEEDS HUMAN/LEGAL REVIEW BEFORE PRODUCTION USE"
    >
      <p>
        Use this page to request deletion of your ShapeUp account and related app data. This flow is intended to remove
        Convex records, AWS S3 scan/generation assets, and the Clerk user account where technically available.
      </p>
      <p>
        Legacy records that cannot be safely attributed to your authenticated account may require manual review by
        [PLACEHOLDER_PRIVACY_EMAIL].
      </p>
      <DeleteAccountPanel />
    </LegalShell>
  );
}
