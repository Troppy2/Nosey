import { useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { driver } from "driver.js";
import { isGuestSession, scopeKey } from "../lib/api";

export const ONBOARDING_DONE_KEY = "nosey_onboarding_done";
export const TOUR_SEGMENT_KEY = "nosey_tour_segment";

type Segment = "dashboard" | "create-test" | "folders" | "kojo";

function getActiveSegment(pathname: string, resumeSegment: string | null, guest: boolean): Segment | null {
  if (pathname === "/dashboard" && !resumeSegment) return "dashboard";
  if (pathname === "/create-test" && resumeSegment === "create-test") return "create-test";
  if (pathname === "/folders" && resumeSegment === "folders") return "folders";
  if (!guest && pathname === "/kojo/chat" && resumeSegment === "kojo") return "kojo";
  return null;
}

export function OnboardingTour() {
  const navigate = useNavigate();
  const location = useLocation();
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);

  useEffect(() => {
    const isDone = !!localStorage.getItem(scopeKey(ONBOARDING_DONE_KEY));
    const resumeSegment = localStorage.getItem(scopeKey(TOUR_SEGMENT_KEY));

    if (isDone && !resumeSegment) return;

    const guest = isGuestSession();
    const segment = getActiveSegment(location.pathname, resumeSegment, guest);
    if (!segment) return;

    const isMobile = window.innerWidth < 760;

    const timer = setTimeout(() => {
      driverRef.current?.destroy();

      let d: ReturnType<typeof driver>;

      if (segment === "dashboard") {
        d = driver({
          showProgress: true,
          progressText: "{{current}} of {{total}}",
          animate: true,
          overlayOpacity: 0.45,
          smoothScroll: true,
          popoverOffset: 12,
          onDestroyed: () => {
            if (!localStorage.getItem(scopeKey(TOUR_SEGMENT_KEY))) {
              localStorage.setItem(scopeKey(ONBOARDING_DONE_KEY), "true");
            }
          },
          steps: [
            {
              popover: {
                title: "Welcome to Nosey!",
                description: "Let's take a quick tour of the key features. Press Next to move through it, or Escape to skip.",
                align: "center",
              },
            },
            {
              element: "#tour-new-test",
              popover: {
                title: "Create a Test",
                description: "Upload your notes (PDF, Word, text) and Nosey generates MCQ and free-response practice questions using AI.",
                side: "bottom",
                align: isMobile ? "center" : "end",
              },
            },
            {
              element: "#tour-stat-grid",
              popover: {
                title: "Your Study Stats",
                description: "Track tests taken, flashcards reviewed, and your average score across all sessions.",
                side: "bottom",
                align: "center",
              },
            },
            {
              element: "#tour-recent-tests",
              popover: {
                title: "Recent Tests",
                description: "All your generated tests live here. Click any to retake it or review your previous answers.",
                side: "top",
                align: isMobile ? "center" : "start",
              },
            },
            {
              element: "#tour-review-cards",
              popover: {
                title: "Weak Flashcards",
                description: "Your hardest cards surface here automatically. Next, let's walk through creating a test.",
                side: isMobile ? "bottom" : "left",
                align: isMobile ? "center" : "start",
                onNextClick: () => {
                  localStorage.setItem(scopeKey(TOUR_SEGMENT_KEY), "create-test");
                  d.destroy();
                  navigate("/create-test");
                },
              },
            },
          ],
        });

      } else if (segment === "create-test") {
        localStorage.removeItem(scopeKey(TOUR_SEGMENT_KEY));
        d = driver({
          showProgress: true,
          progressText: "{{current}} of {{total}}",
          animate: true,
          overlayOpacity: 0.45,
          smoothScroll: true,
          popoverOffset: 12,
          onDestroyed: () => {
            if (!localStorage.getItem(scopeKey(TOUR_SEGMENT_KEY))) {
              localStorage.setItem(scopeKey(ONBOARDING_DONE_KEY), "true");
            }
          },
          steps: [
            {
              element: "#tour-create-type",
              popover: {
                title: "Question Type",
                description: "Pick mixed, MCQ only, or free-response. Advanced mode lets you set exact question counts and difficulty level.",
                side: "top",
                align: "center",
              },
            },
            {
              element: "#tour-create-upload",
              popover: {
                title: "Upload Your Notes",
                description: "Drop in PDFs, Word docs, or text files. Nosey reads them and builds questions from the content automatically.",
                side: "top",
                align: "center",
              },
            },
            {
              popover: {
                title: "That's the test creator!",
                description: "Give your test a title, pick a folder, upload notes, and hit Generate. Next: how folders keep everything organized.",
                align: "center",
                onNextClick: () => {
                  localStorage.setItem(scopeKey(TOUR_SEGMENT_KEY), "folders");
                  d.destroy();
                  navigate("/folders");
                },
              },
            },
          ],
        });

      } else if (segment === "folders") {
        localStorage.removeItem(scopeKey(TOUR_SEGMENT_KEY));
        d = driver({
          showProgress: true,
          progressText: "{{current}} of {{total}}",
          animate: true,
          overlayOpacity: 0.45,
          smoothScroll: true,
          popoverOffset: 12,
          onDestroyed: () => {
            if (!localStorage.getItem(scopeKey(TOUR_SEGMENT_KEY))) {
              localStorage.setItem(scopeKey(ONBOARDING_DONE_KEY), "true");
            }
          },
          steps: [
            {
              popover: {
                title: "Folders",
                description: "Group tests and flashcards by course or subject. Each folder also has its own dedicated Kojo AI chat history.",
                align: "center",
              },
            },
            {
              element: "#tour-folders-new",
              popover: {
                title: "Create a Folder",
                description: guest
                  ? "One folder per course works well. All your tests and flashcards stay organized inside it. Sign in to unlock Kojo AI chat and more."
                  : "One folder per course works well. All your tests, flashcards, and AI conversations stay organized inside it. Next: Kojo, your AI assistant.",
                side: "bottom",
                align: isMobile ? "center" : "end",
                onNextClick: guest ? undefined : () => {
                  localStorage.setItem(scopeKey(TOUR_SEGMENT_KEY), "kojo");
                  d.destroy();
                  navigate("/kojo/chat");
                },
              },
            },
          ],
        });

      } else {
        // segment === "kojo"
        localStorage.removeItem(scopeKey(TOUR_SEGMENT_KEY));
        d = driver({
          showProgress: true,
          progressText: "{{current}} of {{total}}",
          animate: true,
          overlayOpacity: 0.45,
          smoothScroll: true,
          popoverOffset: 12,
          onDestroyed: () => {
            localStorage.setItem(scopeKey(ONBOARDING_DONE_KEY), "true");
          },
          steps: [
            {
              element: "#tour-kojo-chat",
              popover: {
                title: "Chat with Kojo",
                description: "Kojo is your AI study assistant. Ask it to explain a concept, quiz you, or summarize your notes. When you're in a folder, it knows your uploaded content.",
                side: "top",
                align: "center",
              },
            },
            {
              popover: {
                title: "You're all set!",
                description: "That's the full tour. Head to Create Test to get started, or explore any section from the sidebar. Good luck studying!",
                align: "center",
              },
            },
          ],
        });
      }

      driverRef.current = d;
      d.drive();
    }, 700);

    return () => {
      clearTimeout(timer);
    };
  }, [location.pathname]);

  return null;
}
