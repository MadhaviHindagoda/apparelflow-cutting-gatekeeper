import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import SupervisorPage from './pages/SupervisorPage.jsx';
import VerifierPage from './pages/VerifierPage.jsx';
import SewingPage from './pages/SewingPage.jsx';
import { useAuth } from './context/AuthContext';
import { ROLE_HOME } from './roles';

function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={ROLE_HOME[user.role]} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<HomeRedirect />} />

          <Route element={<ProtectedRoute roles={['cutting_supervisor']} />}>
            <Route path="/supervisor" element={<SupervisorPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={['cutting_verifier']} />}>
            <Route path="/verifier" element={<VerifierPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={['sewing_supervisor']} />}>
            <Route path="/sewing" element={<SewingPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}