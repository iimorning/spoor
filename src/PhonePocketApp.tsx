import { useState } from 'react';
import { PocketView } from './components/PocketView';
import { PhoneSettingsModal } from './components/PhoneSettingsModal';
import { useAuth } from './contexts/AuthContext';

export default function PhonePocketApp() {
  const auth = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex h-screen max-h-screen flex-col overflow-hidden bg-[#FAF9F6]">
      <PocketView
        onOpenLogin={auth.configured ? () => setSettingsOpen(true) : undefined}
        accountSignedIn={!!auth.session}
      />
      {settingsOpen ? (
        <PhoneSettingsModal isOpen onClose={() => setSettingsOpen(false)} />
      ) : null}
    </div>
  );
}
