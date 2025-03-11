import { Link } from "react-router-dom";
import CalendarStories from "./experiments/CalendarStories";
import InteractiveTitle from "./components/InteractiveTitle";

const experiments = [
  {
    id: "calendar-stories",
    title: "Calendar Stories",
    description: "A 3D exploration of the calendar",
    thumbnail: "/images/calendar-stories.png",
    component: CalendarStories,
  },
];

const Home = () => {
  return (
    <div className="space-y-12">
      <InteractiveTitle />

      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {experiments.map((experiment) => (
            <Link
              key={experiment.id}
              to={`/experiment/${experiment.id}`}
              className="group"
            >
              <div className="bg-white rounded-lg shadow-md overflow-hidden transition-transform transform hover:scale-105">
                <div className="aspect-w-16 aspect-h-9 bg-gray-100">
                  <img
                    src={experiment.thumbnail}
                    alt={experiment.title}
                    className="object-cover"
                  />
                </div>
                <div className="p-4">
                  <h2 className="text-xl font-semibold mb-2">
                    {experiment.title}
                  </h2>
                  <p className="text-gray-600">{experiment.description}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Home;
