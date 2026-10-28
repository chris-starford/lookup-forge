import { createRoot } from 'react-dom/client';
import { createMock } from './mock-cribl';
import LookupManagerApp from '../src/lookup-manager/ui/LookupManagerApp';

const params = new URLSearchParams(location.search);
const mock = createMock({ searchLookupApi: params.get('searchApi') !== 'off', autoDeliver: true });
(window as any).__mock = mock.state;
window.fetch = mock.fetch as typeof fetch;
window.getCriblUser = async () => ({ id: 'u1', username: 'chris.starford' });
window.CRIBL_API_URL = 'https://cribl.local/api/v1'; // like the platform: the API base, not an app-scoped path
createRoot(document.getElementById('root')!).render(<LookupManagerApp />);
