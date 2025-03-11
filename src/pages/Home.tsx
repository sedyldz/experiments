import { Link } from "react-router-dom";
import { experiments } from "../data/experiments";

const Home = () => {
  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-8">Interactive Experiments</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {experiments.map((experiment) => (
            <Link key={experiment.id} to={experiment.path} className="group">
              <div className="bg-white rounded-lg shadow-md overflow-hidden transition-transform hover:scale-105">
                <div className="aspect-w-16 aspect-h-9 bg-gray-200">
                  <img
                    src={experiment.thumbnail}
                    alt={experiment.title}
                    className="object-cover"
                  />
                </div>
                <div className="p-6">
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
