import { createRoot } from 'react-dom/client';
import { UpdateWindow } from './UpdateWindow';
import { TitleBar } from './TitleBar';
import './update.css';

const params = new URLSearchParams(window.location.search);
const view = params.get('view') || window.location.hash.replace(/^#/, '');
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('未找到 #root 挂载节点');
}

if (view === 'update') {
  createRoot(rootElement).render(<UpdateWindow />);
} else {
  createRoot(rootElement).render(<TitleBar />);
}
