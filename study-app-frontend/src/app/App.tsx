import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";
import CreateTest from "../pages/CreateTest";
import Dashboard from "../pages/Dashboard";
import Flashcards from "../pages/Flashcards";
import FlashcardsManage from "../pages/FlashcardsManage";
import FolderDetail from "../pages/FolderDetail";
import Folders from "../pages/Folders";
import Landing from "../pages/Landing";
import KojoMode from "../pages/KojoMode";
import LeetCodeMode from "../pages/LeetCodeMode";
import { isAuthenticated, isGuestSession, scopeKey } from "../lib/api";
import MockInterviewSetup from "../pages/MockInterviewSetup";
import MockInterviewResume from "../pages/MockInterviewResume";
import MockInterviewStage1 from "../pages/MockInterviewStage1";
import MockInterviewStage2 from "../pages/MockInterviewStage2";
import MockInterviewStage3 from "../pages/MockInterviewStage3";
import MockInterviewStage1Results from "../pages/MockInterviewStage1Results";
import MockInterviewSummary from "../pages/MockInterviewSummary";
import QuestionEditor from "../pages/QuestionEditor";
import Results from "../pages/Results";
import TakeTest from "../pages/TakeTest";
import AdminPanel from "../pages/AdminPanel";
import Settings from "../pages/Settings";

// Dependency imports for tracking the last visited path
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

function SignedInRoute({ children }: { children: React.ReactNode }) {
  if (isGuestSession()) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// Gate for the app's protected routes. Anonymous visitors (no signed-in user
// and no guest session) are sent to the landing/login page so they can make an
// account or start as a guest, instead of auto-loading the dashboard.
function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Saves user last visted page
function PathTracker() {
  const location = useLocation();

  useEffect(() => {
    localStorage.setItem(scopeKey("lastVisitedPath"), location.pathname);
  }, [location.pathname]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<RequireAuth><Sidebar /></RequireAuth>}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/folders" element={<Folders />} />
          <Route path="/folders/:folderId" element={<FolderDetail />} />
          <Route path="/create-test" element={<CreateTest />} />
          <Route path="/test/:testId" element={<TakeTest />} />
          <Route path="/test/:testId/edit" element={<QuestionEditor />} />
          <Route path="/results/:attemptId" element={<Results />} />
          <Route path="/flashcards" element={<Flashcards />} />
          <Route path="/flashcards/:folderId" element={<Flashcards />} />
          <Route path="/folders/:folderId/flashcards/manage" element={<FlashcardsManage />} />
          <Route path="/leetcode" element={<SignedInRoute><LeetCodeMode /></SignedInRoute>} />
          <Route path="/mock-interview" element={<MockInterviewSetup />} />
          <Route path="/mock-interview/:sessionId/resume" element={<MockInterviewResume />} />
          <Route path="/mock-interview/:sessionId/stage1" element={<MockInterviewStage1 />} />
          <Route path="/mock-interview/:sessionId/stage1-results" element={<MockInterviewStage1Results />} />
          <Route path="/mock-interview/:sessionId/stage2" element={<MockInterviewStage2 />} />
          <Route path="/mock-interview/:sessionId/stage3" element={<MockInterviewStage3 />} />
          <Route path="/mock-interview/:sessionId/summary" element={<MockInterviewSummary />} />
          <Route path="/kojo/chat" element={<KojoMode />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={<AdminPanel />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
