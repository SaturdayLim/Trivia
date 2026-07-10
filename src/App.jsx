/**
 * @file The three role routes (PRD §2). One app, one bundle, three entry points.
 *
 * BrowserRouter, not HashRouter, because the join URL goes on a QR code and
 * `/play?room=ABCD` is what a camera should hand a human. That requires the
 * host to rewrite unknown paths to index.html — see `vercel.json`, which also
 * has to keep `/questions` and `/icons` from being swallowed by the rewrite.
 */

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Home from './screens/Home.jsx';
import Host from './screens/Host.jsx';
import Play from './screens/Play.jsx';
import Display from './screens/Display.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/host" element={<Host />} />
        <Route path="/play" element={<Play />} />
        <Route path="/display" element={<Display />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
