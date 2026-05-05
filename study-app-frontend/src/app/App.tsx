import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import CreateTest from "../pages/CreateTest";
import Dashboard from "../pages/Dashboard";
import Flashcards from "../pages/Flashcards";
import FlashcardsManage from "../pages/FlashcardsManage";
import FolderDetail from "../pages/FolderDetail";
import Folders from "../pages/Folders";
import Landing from "../pages/Landing";
import KojoMode from "../pages/KojoMode";
import LeetCodeMode from "../pages/LeetCodeMode";
import QuestionEditor from "../pages/QuestionEditor";
import Results from "../pages/Results";
import TakeTest from "../pages/TakeTest";
import Settings from "../pages/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<AppShell />}>
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
          <Route path="/leetcode" element={<LeetCodeMode />} />
          <Route path="/kojo/chat" element={<KojoMode />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
