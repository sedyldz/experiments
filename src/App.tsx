import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import ExperimentDetail from "./pages/ExperimentDetail";
import CalendarStories from "./experiments/CalendarStories";
import CameraPortal from "./experiments/CameraPortal";
import HandPush from "./experiments/HandPush";

function App() {
  return (
    <Router>
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
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
