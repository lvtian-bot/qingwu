import React from 'react';
import { createRoot } from 'react-dom/client';
import { UpdateWindow } from './UpdateWindow.jsx';
import { TitleBar } from './TitleBar.jsx';
import './update.css';

const params = new URLSearchParams(window.location.search);
const view = params.get('view') || window.location.hash.replace(/^#/, '');

if (view === 'update') {
  createRoot(document.getElementById('root')).render(<UpdateWindow />);
} else {
  createRoot(document.getElementById('root')).render(<TitleBar />);
}
