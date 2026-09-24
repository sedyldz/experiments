import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import ExperimentDetail from "./pages/ExperimentDetail";
import CalendarStories from "./experiments/CalendarStories";
import CameraPortal from "./experiments/CameraPortal";
import HandPush from "./experiments/HandPush";
import PixelWorld from "./experiments/pixel-world";

function App() {
  return (
    <Router basename={import.meta.env.BASE_URL}>
      <div className="min-h-screen bg-gray-50">
        <main className="container mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/experiment/:id" element={<ExperimentDetail />} />
            <Route
              path="/experiments/calendar-stories"
              element={<CalendarStories />}
            />
            <Route
              path="/experiments/camera-portal"
              element={<CameraPortal />}
            />
            <Route path="/experiments/hand-push" element={<HandPush />} />
            <Route path="/experiments/pixel-world" element={<PixelWorld />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
