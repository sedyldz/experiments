import { useParams } from "react-router-dom";
import { experiments } from "../data/experiments";

const ExperimentDetail = () => {
  const { id } = useParams();
  const experiment = experiments.find((exp) => exp.id === id);

  if (!experiment) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-2xl text-gray-600">Experiment not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-4">{experiment.title}</h1>
        <p className="text-gray-600 text-lg mb-8">{experiment.description}</p>
        {experiment.githubUrl && (
          <a
            href={experiment.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-700"
          >
            View on GitHub
          </a>
        )}
      </div>
    </div>
  );
};

export default ExperimentDetail;
