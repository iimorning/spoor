import App from './App';
import { EnsureBillingProvider } from './contexts/BillingContext';

export default function DesktopAppEntry() {
  return (
    <EnsureBillingProvider>
      <App />
    </EnsureBillingProvider>
  );
}
