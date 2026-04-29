# Nosey Study App - Enhanced Frontend Implementation Prompt

## Overview
Build a production-ready React TypeScript frontend for the Nosey Study App with refined UI/UX, enhanced animations, and desktop-first design principles. This implementation builds upon the demo foundation but with significantly improved polish, spacing, and interactive states.

---

## Design Philosophy

### Core Principles
1. **Desktop-First**: Optimize for 1920px+ displays; responsive down to 1024px (tablets)
2. **Refined Elegance**: Natural green palette with thoughtful negative space
3. **Smooth Interactions**: All interactions have immediate visual feedback through transitions
4. **Clear Hierarchy**: Proper spacing creates visual relationships between elements
5. **Performance First**: Animations are performant (GPU-accelerated transforms)

### Color System (Enhanced)
```css
/* Primary Green Palette */
--green-lightest: #e9f5db;     /* Page background */
--green-light: #cfe1b9;        /* Cards, secondary surfaces */
--green-light-mid: #b5c99a;    /* Borders, dividers */
--green-mid: #97a97c;          /* Secondary text, icons */
--green-dark-mid: #87986a;     /* Primary text, labels */
--green-dark: #718355;         /* CTA, interactive elements */

/* Semantic Feedback */
--success: #10B981;   /* Correct answers, positive feedback */
--warning: #D97706;   /* Caution, medium difficulty */
--error: #DC2626;     /* Incorrect, negative feedback */
--info: #3B82F6;      /* Informational elements */

/* Interactive States */
--hover-opacity: 0.95;           /* Hover brightness for cards */
--active-opacity: 0.90;          /* Active state */
--disabled-opacity: 0.5;
--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
--shadow-md: 0 4px 6px rgba(0,0,0,0.08);
--shadow-lg: 0 10px 15px rgba(0,0,0,0.1);
--shadow-hover: 0 20px 25px rgba(0,0,0,0.12);

/* Transitions */
--transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-normal: 250ms cubic-bezier(0.4, 0, 0.2, 1);
--transition-slow: 350ms cubic-bezier(0.4, 0, 0.2, 1);
```

---

## Spacing & Layout Standards

### Container & Grid
```scss
/* Page container */
max-width: 1400px;
margin: 0 auto;
padding: 40px 48px; /* Desktop default */

/* Responsive breakpoints */
Desktop (1920px+): 48px horizontal padding
Large Desktop (1200px-1920px): 40px horizontal padding  
Desktop (1024px-1200px): 32px horizontal padding
Tablet (768px-1024px): 24px horizontal padding

/* Grid gaps */
Grid gaps: 24px (default), 32px (spacious layouts)
Section spacing: 48px vertical between major sections
Item spacing: 16px between card/list items
```

### Spacing Scale
```
xs: 4px
sm: 8px
md: 12px
lg: 16px
xl: 24px
2xl: 32px
3xl: 48px
4xl: 64px
```

---

## Component Specifications

### Cards (All Interactive Cards)
**Base Properties:**
```tsx
// Structure
<div className="group relative">
  {/* Card container with transitions */}
  <div className="bg-white rounded-lg shadow-md border border-green-light-mid 
                  transition-all duration-300 cursor-pointer
                  hover:shadow-lg hover:scale-102 hover:border-green-mid
                  active:scale-98">
    {/* Content */}
  </div>
</div>
```

**States & Animations:**
- **Default**: `shadow-md`, `border-green-light-mid`
- **Hover**: 
  - `shadow-lg` (elevated shadow)
  - `scale(1.02)` transform
  - `border-green-mid` (darker border)
  - Background subtle shift
- **Active**: `scale(0.98)` (press feedback)
- **Focus**: Ring outline with `outline-offset: 2px`
- **Disabled**: `opacity-50`, `cursor-not-allowed`

**Transition Timing**: 250ms cubic-bezier(0.4, 0, 0.2, 1)

### Buttons (All Interactive Buttons)

**Primary Button:**
```tsx
className="px-6 py-3 bg-green-dark text-green-lightest rounded-lg
           font-semibold transition-all duration-250 ease-out
           hover:bg-green-dark-mid hover:shadow-lg hover:scale-105
           active:scale-95
           focus:outline-none focus:ring-2 focus:ring-green-dark focus:ring-offset-2
           disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
```

**Secondary Button:**
```tsx
className="px-6 py-3 bg-green-light text-green-dark rounded-lg
           border border-green-light-mid font-semibold
           transition-all duration-250 ease-out
           hover:bg-green-light-mid hover:shadow-md hover:scale-105
           active:scale-95
           focus:outline-none focus:ring-2 focus:ring-green-mid focus:ring-offset-2"
```

**Ghost Button:**
```tsx
className="px-4 py-2 text-green-dark rounded-md
           transition-all duration-200
           hover:bg-green-light hover:bg-opacity-50
           active:bg-opacity-75"
```

**States:**
- **Default**: Clear color, no shadow
- **Hover**: Background darkens, shadow appears, slight scale up (1.05x)
- **Active**: Scale down to 0.95x for press feedback
- **Focus**: Visible focus ring (2px offset)
- **Disabled**: 50% opacity, no interactions

**Spacing:** Minimum 48px × 48px touch target on desktop

### Form Inputs

**Text Input/Textarea:**
```tsx
className="w-full px-4 py-3 rounded-lg
           border border-green-light-mid
           bg-green-lightest text-green-dark-mid
           placeholder:text-green-mid placeholder:opacity-60
           transition-all duration-200
           focus:outline-none focus:ring-2 focus:ring-green-dark 
           focus:ring-offset-2 focus:border-green-dark
           hover:border-green-mid
           disabled:bg-gray-100 disabled:cursor-not-allowed"
```

**States:**
- **Focus**: Ring outline + border color change
- **Hover**: Subtle border color shift
- **Error**: Ring becomes red/error color
- **Disabled**: Grayed out, no interactions

**Spacing:**
- Padding: 12px 16px (vertical × horizontal)
- Label margin-bottom: 8px
- Field margin-bottom: 16px
- Input height: 44px minimum (touch-friendly)

### Select Dropdowns

```tsx
className="w-full px-4 py-3 rounded-lg
           border border-green-light-mid bg-green-lightest
           text-green-dark-mid
           transition-all duration-200
           hover:border-green-mid
           focus:outline-none focus:ring-2 focus:ring-green-dark
           appearance-none cursor-pointer"
```

### Progress Indicators

**Progress Bar:**
```tsx
// Container
className="w-full h-2 bg-green-light rounded-full overflow-hidden"

// Fill
className="h-full bg-green-dark transition-all duration-500 ease-out rounded-full"
```

**Circular Progress:**
```tsx
className="w-24 h-24 rounded-full 
           border-4 border-green-light
           border-t-green-dark border-r-green-dark-mid
           animate-spin-slow"
```

---

## Page-Specific Guidelines

### Landing Page
**Layout:**
- Centered single column
- Max-width: 480px
- Vertical center on viewport (min-height: 100vh)
- Top padding: 40px, bottom: auto
- 16px horizontal margin on mobile

**Sign-in Card:**
- 32px padding
- Border: 1px `green-light-mid`
- Background: `green-light` with opacity
- Spacing between elements:
  - Logo to heading: 32px
  - Heading to button: 24px
  - Button to secondary text: 24px
  - Secondary text to features: 32px

**Hero Button:**
- Full width
- Minimum height: 48px
- On hover: subtle lift (shadow), scale 1.02
- Font size: 16px
- Transition: 250ms

**Feature List:**
- Gap between items: 16px
- Each feature item: 32px padding, rounded-lg background
- Icon margin-right: 16px
- Title font-weight: 600
- Description font-size: 14px, color: `green-mid`

---

### Dashboard Page
**Header Section:**
- Top margin: 40px
- Bottom margin: 48px
- Flex container: justify-between items-center gap-16

**Title:**
- Font size: 32px
- Font family: serif
- Font weight: 600
- Margin-bottom: 24px

**Quick Stats Grid:**
- Columns: 3 (desktop), 2 (tablet), 1 (mobile)
- Gap: 24px
- Each stat card:
  - Padding: 24px
  - Background: `green-light` with gradient overlay
  - Border: 1px `green-light-mid`
  - On hover: shadow-lg, scale-102

**Sections (Folders, Recent Tests, Weak Cards):**
- Section margin-bottom: 48px
- Section header spacing:
  - Title margin-bottom: 16px
  - Gap between title and "View all": 8px
- Grid gaps: 24px
- Card height: min-height 120px (folders), auto (tests)

**Hover States on Cards:**
- Box shadow elevates to `shadow-lg`
- Border color shifts from `green-light-mid` to `green-mid`
- Slight scale transform (1.02)
- Background subtle darkening (opacity shift)
- Transition: 250ms cubic-bezier

---

### Create Test Page
**Header:**
- Back button size: 16px (icon)
- Back link text: 14px, color `green-dark`
- Title: 32px serif, margin-bottom 24px
- Subtitle: 14px, color `green-mid`, margin-top 8px

**File Upload Section:**
- Drag-and-drop area height: 160px (dragging: 180px)
- Border: 2px dashed `green-light-mid`
- Background: `green-light` opacity 0.3
- On drag-over:
  - Border becomes solid `green-dark`
  - Background opacity: 0.5
  - Slight scale transform (1.02)
  - Transition: 200ms

**Form Fields:**
- Vertical gap: 24px
- Label font-weight: 500, margin-bottom 8px
- Input height: 44px
- Input padding: 12px 16px

**Button Group:**
- Gap: 12px
- Primary button takes 60% width
- Secondary button takes 40% width

---

### Take Test Page
**Header:**
- Sticky top: 0, z-index: 40
- Background: `green-lightest` with backdrop blur
- Padding: 20px 32px
- Box shadow: `shadow-md`
- Border-bottom: 1px `green-light-mid`

**Progress Bar:**
- Height: 4px
- Background: `green-light`
- Fill: `green-dark`
- Position: sticky top (above header)
- Transition: 500ms ease-out

**Question Section:**
- Max-width: 800px
- Center aligned
- Margin: 40px auto
- Padding: 0 32px

**Question Card:**
- Background: white/`green-lightest`
- Padding: 40px
- Border-radius: 8px
- Box shadow: `shadow-md`
- Margin-bottom: 32px

**Multiple Choice Options:**
- Display: grid (1 column)
- Gap: 16px
- Each option:
  - Padding: 16px 20px
  - Border: 2px solid `green-light-mid`
  - Border-radius: 8px
  - Background: white
  - Cursor: pointer
  - Transition: 200ms
  - On hover:
    - Border-color: `green-mid`
    - Background: `green-light` opacity 0.3
    - Scale: 1.02
  - On select (checked):
    - Border-color: `green-dark`
    - Background: `green-dark` opacity 0.1
    - Box-shadow: inset 0 0 0 3px `green-dark`

**Navigation Buttons:**
- Container: flex gap-16 justify-center margin-top 40px
- Button width: 140px
- Disabled state: opacity 0.5, cursor-not-allowed
- On hover (if enabled): shadow-lg, scale 1.05

---

### Flashcards Page
**Card Flip Animation:**
```scss
perspective: 1000px;
transform-style: preserve-3d;
transition: transform 600ms cubic-bezier(0.4, 0, 0.2, 1);
transform: rotateY(${isFlipped ? 180 : 0}deg);

/* Front/Back faces */
backface-visibility: hidden;
.card-front { transform: rotateY(0deg); }
.card-back { transform: rotateY(180deg); }
```

**Card Container:**
- Width: 100%
- Height: 400px
- Max-width: 600px
- Center aligned
- Margin: 40px auto
- Padding: 40px
- Border-radius: 16px
- Box shadow: `shadow-lg`
- On hover: `shadow-hover`, subtle lift

**Progress Bar:**
- Position: sticky top with backdrop blur
- Style: similar to Take Test

**Confidence Buttons:**
- Container: flex gap-12 justify-center margin-top 40px
- Button count: 3 (Easy, Medium, Hard)
- Button colors:
  - Easy: `success` color
  - Medium: `warning` color
  - Hard: `error` color
- States:
  - Default: outlined button with color border
  - Hover: fill with color, text white
  - Active: scale 0.95, shadow inset

---

### Results Page
**Score Display:**
- Background: gradient (success/warning/error based on score)
- Padding: 48px 32px
- Border-radius: 16px
- Text: white
- Score number: 64px font, font-weight 700
- Subtitle: 18px, opacity 0.9

**Score Breakdown:**
- Grid: 3 columns
- Gap: 24px
- Each stat:
  - Padding: 24px
  - Background: white
  - Border: 1px `green-light-mid`
  - Border-radius: 8px
  - Text align: center

**Result Items:**
- Container: divide-y border-top/bottom `green-light-mid`
- Padding: 24px each
- Margin-bottom: 16px
- On hover:
  - Background: `green-light` opacity 0.3
  - Left border: 4px solid `green-dark`
  - Transition: 200ms

**Accordion Items (for detailed feedback):**
- Padding: 20px
- Margin-bottom: 12px
- Border: 1px `green-light-mid`
- Border-radius: 8px
- On expand:
  - Background: `green-light`
  - Icon rotate: 180deg (200ms)
  - Content fade in: 200ms

---

### Folders Page
**Header:**
- Margin-bottom: 32px
- Title: 28px serif
- Controls: flex gap-12 align-center

**View Mode Toggle:**
- Button group: flex gap-8
- Button size: 40px × 40px
- Border: 1px `green-light-mid`
- Background: white
- On active: background `green-dark`, color white
- On hover: background `green-light`
- Transition: 150ms

**Folder Grid:**
- Display: grid
- Columns: 2-3 (desktop), 2 (tablet), 1 (mobile)
- Gap: 24px
- Responsive:
  - 1400px+: 3 columns
  - 1024px-1400px: 2 columns
  - <1024px: 1 column

**Folder Card (Grid View):**
- Aspect ratio: 3/4
- Padding: 24px
- Border: 1px `green-light-mid`
- Border-radius: 8px
- Background: white with gradient overlay
- Position: relative
- On hover:
  - Shadow: `shadow-lg`
  - Border: `green-mid`
  - Scale: 1.02
  - Overlay appears (dark with opacity)

**Folder Card (List View):**
- Padding: 20px 24px
- Display: flex gap-24 align-center
- Height: 80px
- Border-bottom: 1px `green-light-mid`
- On hover: background `green-light` opacity 0.3
- Folder icon: 32px, color based on folder

**Folder Color Indicator:**
- Size: 12px
- Border-radius: 50%
- Positioned: top-right corner of card
- Background: folder's assigned color

**Create Folder Button:**
- Size: 48px × 48px
- Position: fixed bottom-right or sticky within scroll
- Border-radius: 50%
- Background: `green-dark`
- Icon: Plus (24px)
- Color: white
- On hover: shadow-lg, scale 1.1
- On active: scale 0.95

---

## Animation Library

### Transition Utilities
```css
.transition-fast { transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1); }
.transition-normal { transition: all 250ms cubic-bezier(0.4, 0, 0.2, 1); }
.transition-slow { transition: all 350ms cubic-bezier(0.4, 0, 0.2, 1); }

.transition-colors { transition: color, background-color, border-color 250ms cubic-bezier(0.4, 0, 0.2, 1); }
.transition-transform { transition: transform 250ms cubic-bezier(0.4, 0, 0.2, 1); }
.transition-shadow { transition: box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1); }
```

### Keyframe Animations
```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideInUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes slideInDown {
  from { transform: translateY(-20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes scaleIn {
  from { transform: scale(0.95); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(113, 131, 85, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(113, 131, 85, 0); }
}

@keyframes shimmer {
  0% { background-position: -1000px 0; }
  100% { background-position: 1000px 0; }
}
```

### Hover Scale Utilities
```css
.hover\:scale-102:hover { transform: scale(1.02); }
.hover\:scale-105:hover { transform: scale(1.05); }
.hover\:scale-110:hover { transform: scale(1.1); }
.active\:scale-95:active { transform: scale(0.95); }
.active\:scale-98:active { transform: scale(0.98); }
```

---

## Interactive Features & Effects

### Tooltip Patterns
```tsx
<div className="group relative">
  <button>Hover me</button>
  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2
                  px-3 py-2 rounded-md bg-green-dark text-white text-sm
                  opacity-0 pointer-events-none
                  group-hover:opacity-100 group-hover:pointer-events-auto
                  transition-all duration-200
                  whitespace-nowrap">
    Tooltip text
  </div>
</div>
```

### Loading States
```tsx
/* Skeleton loader */
className="animate-pulse bg-gradient-to-r from-green-light to-green-light-mid 
           bg-[length:1000px_100%] animate-shimmer"

/* Loading spinner */
className="w-8 h-8 border-4 border-green-light border-t-green-dark 
           rounded-full animate-spin"

/* Pulse indicator */
className="animate-pulse opacity-75"
```

### Blur Backdrop Effects
```tsx
/* Modal overlay */
className="fixed inset-0 bg-black bg-opacity-40 backdrop-blur-sm 
           transition-all duration-300
           data-[open=true]:opacity-100 data-[open=true]:pointer-events-auto"

/* Header with blur */
className="sticky top-0 bg-green-lightest backdrop-blur-md 
           bg-opacity-80 shadow-md border-b border-green-light-mid"
```

### Dropdown Menu Animations
```tsx
/* Dropdown appearance */
className="absolute top-full left-0 mt-2 rounded-lg
           bg-white border border-green-light-mid
           shadow-lg
           opacity-0 scale-95 pointer-events-none
           group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto
           transition-all duration-200
           origin-top"
```

---

## Desktop-Specific Considerations

### Mouse Interactions
- Hover states on all interactive elements
- Cursor changes: pointer on clickables, not-allowed on disabled
- Focus rings visible on keyboard tab
- No tap highlighting on desktop

### Scrolling Behavior
- Smooth scroll enabled globally
- Sticky headers with subtle blur
- Scrollbar styling (thin, subtle green tones)
- Preserve scroll position on navigation

### Keyboard Navigation
- Tab order follows visual flow
- Focus visible: 2px outline with offset
- Enter/Space trigger buttons and links
- Arrow keys for carousel/list navigation

### Responsiveness
- Breakpoint system:
  - Desktop: 1024px+
  - Tablet: 768px-1024px
  - Mobile: <768px
- Desktop prioritizes horizontal layouts
- Tablet/mobile stack vertically
- Maintain 48px minimum touch targets

---

## Code Structure & Organization

### Component Hierarchy
```
src/
├── app/
│   ├── components/
│   │   ├── ui/              # shadcn components
│   │   ├── layout/          # Header, Sidebar, Footer
│   │   ├── cards/           # Reusable card components
│   │   └── forms/           # Form components
│   ├── pages/               # Route pages
│   │   ├── Landing.tsx
│   │   ├── Dashboard.tsx
│   │   ├── CreateTest.tsx
│   │   ├── TakeTest.tsx
│   │   ├── Flashcards.tsx
│   │   ├── Results.tsx
│   │   └── Folders.tsx
│   └── App.tsx
├── styles/
│   ├── globals.css          # Global resets + utilities
│   ├── theme.css            # CSS variables
│   ├── components.css       # Component-specific styles
│   ├── animations.css       # Keyframe animations
│   └── tailwind.css         # Tailwind config
└── main.tsx
```

### CSS Architecture
1. **theme.css**: CSS custom properties (colors, sizing, timing)
2. **globals.css**: Base styles, typography, resets
3. **components.css**: Component classes with modifiers
4. **animations.css**: Keyframe definitions and animation utilities

### Naming Conventions
- CSS classes: kebab-case (`button-primary`, `card-hover`)
- CSS variables: kebab-case with scope (`--green-dark`, `--transition-normal`)
- React components: PascalCase (`StatCard`, `TestCard`)
- TypeScript types: PascalCase (`Question`, `QuestionResult`)

---

## Performance Optimization

### Rendering
- Use React.memo for cards and list items
- Implement virtualization for long lists
- Lazy load page components with React.lazy()

### Animations
- Use `transform` and `opacity` for animations (GPU-accelerated)
- Avoid animating dimensions, position properties
- Debounce scroll/resize listeners
- Prefer CSS animations over JS for repeating loops

### Images
- Use WebP with PNG fallback
- Implement lazy loading for below-fold images
- Optimize at build time with next/image equivalent

### Bundle Size
- Tree-shake unused UI components
- Code split by route
- Minimize vendor bundle impact

---

## Testing Checklist

### Visual Testing
- [ ] All hover states work on desktop
- [ ] All animations smooth (60fps)
- [ ] Blur effects visible and performant
- [ ] Spacing consistent across pages
- [ ] Colors match theme system
- [ ] Focus rings visible on tab navigation

### Interaction Testing
- [ ] Button clicks register immediately
- [ ] Form inputs clear/submit work
- [ ] Drag-and-drop functions properly
- [ ] Animations don't block interaction
- [ ] Disabled states prevent interaction

### Responsive Testing
- [ ] Desktop layouts (1920px, 1440px, 1024px)
- [ ] Tablet layouts (768px)
- [ ] Touch targets ≥48px
- [ ] Text readable at all breakpoints
- [ ] Horizontal scrolling doesn't occur

### Accessibility
- [ ] Keyboard navigation complete
- [ ] Focus visible at all times
- [ ] Color contrast ≥4.5:1
- [ ] ARIA labels where needed
- [ ] Screen reader friendly

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- Setup React TS project with Vite
- Configure Tailwind with custom theme
- Implement base styling system (theme.css, globals.css)
- Create core component library (Button, Card, Input, etc.)
- Setup animation utilities

### Phase 2: Pages (Week 2-3)
- Landing page with polish
- Dashboard with all sections
- CreateTest with drag-and-drop
- Folders with grid/list toggle
- Wire up routing

### Phase 3: Interactive Pages (Week 3-4)
- TakeTest with progress tracking
- Flashcards with flip animation
- Results with interactive breakdown
- Loading states and transitions

### Phase 4: Polish & Optimization (Week 4)
- Micro-interactions refinement
- Performance optimization
- Responsive refinement
- Accessibility audit
- Cross-browser testing

---

## Additional Notes

### Design Inspiration
- Look to Notion, Linear, Figma for refined spacing and interactions
- Subtle animations that enhance but don't distract
- Professional yet approachable aesthetic
- Green palette creates natural, calm study environment

### Browser Support
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- No IE11 support

### Future Enhancements
- Dark mode toggle
- Custom theme colors
- Advanced animation preferences
- Data visualization enhancements
- Real-time collaboration features
