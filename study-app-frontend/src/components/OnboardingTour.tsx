import { useEffect, useRef } from "react";
import { driver } from "driver.js";

const ONBOARDING_KEY = "nosey_onboarding_done";

export function OnboardingTour() {
  const isReplayRef = useRef(false);

  useEffect(() => {
    if (localStorage.getItem(ONBOARDING_KEY)) return;

    const timer = setTimeout(() => {
      const driverObj = driver({
        showProgress: true,
        progressText: "{{current}} of {{total}}",
        animate: true,
        overlayOpacity: 0.45,
        smoothScroll: true,
        popoverOffset: 12,
        onDestroyed: () => {
          if (!isReplayRef.current) {
            localStorage.setItem(ONBOARDING_KEY, "true");
          }
          isReplayRef.current = false;
        },
        steps: [
          {
            element: "#tour-new-test",
            popover: {
              title: "Create a Test",
              description:
                "Start here , upload your notes (PDF, TXT, or Markdown) and Nosey generates MCQ or FRQ practice questions powered by AI.",
              side: "bottom",
              align: "end",
            },
          },
          {
            element: "#tour-stat-grid",
            popover: {
              title: "Your Study Stats",
              description:
                "Track tests taken, flashcards reviewed, and your average score across all sessions.",
              side: "bottom",
              align: "center",
            },
          },
          {
            element: "#tour-recent-tests",
            popover: {
              title: "Recent Tests",
              description:
                "All your generated tests live here. Click any test to retake it or review your answers.",
              side: "top",
              align: "start",
            },
          },
          {
            element: "#tour-review-cards",
            popover: {
              title: "Review These",
              description:
                "Your hardest flashcards surface here automatically , great for a quick drill before an exam.",
              side: "left",
              align: "start",
            },
          },
          {
            element: "#tour-nav-folders",
            popover: {
              title: "Folders",
              description:
                "Group your tests and flashcards by subject or course to stay organized.",
              side: "right",
              align: "center",
            },
          },
          {
            element: "#tour-nav-kojo",
            popover: {
              title: "Chat with Kojo",
              description:
                "Kojo is your AI study assistant. Ask it to explain concepts, quiz you, or clarify anything from your notes.",
              side: "right",
              align: "center",
            },
          },
          {
            popover: {
              title: "You're all set!",
              description:
                "That covers the essentials. Head over to Create Test to get started , good luck studying!",
              align: "center",
              customButtons: [
                {
                  text: "Replay tour",
                  side: "left",
                  className: "tour-replay-btn",
                  onClick: () => {
                    isReplayRef.current = true;
                    driverObj.drive(0);
                  },
                },
              ],
            },
          },
        ],
      });

      driverObj.drive();
    }, 800);

    return () => clearTimeout(timer);
  }, []);

  return null;
}
