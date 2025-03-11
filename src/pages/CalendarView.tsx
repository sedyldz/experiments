import { useState, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text } from "@react-three/drei";
import * as THREE from "three";

interface DayBlockProps {
  date: Date;
  position: THREE.Vector3;
  isSelected: boolean;
  onClick: () => void;
}

const DayBlock: React.FC<DayBlockProps> = ({
  date,
  position,
  isSelected,
  onClick,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const hovered = useRef(false);

  useFrame(() => {
    if (!meshRef.current) return;
    meshRef.current.rotation.x = THREE.MathUtils.lerp(
      meshRef.current.rotation.x,
      hovered.current ? Math.PI / 8 : 0,
      0.1
    );
    meshRef.current.scale.setScalar(
      THREE.MathUtils.lerp(meshRef.current.scale.x, isSelected ? 1.2 : 1, 0.1)
    );
  });

  return (
    <mesh
      ref={meshRef}
      position={position}
      onClick={onClick}
      onPointerOver={() => (hovered.current = true)}
      onPointerOut={() => (hovered.current = false)}
    >
      <boxGeometry args={[0.9, 0.9, 0.1]} />
      <meshStandardMaterial
        color={isSelected ? "#0066ff" : "#ffffff"}
        metalness={0.5}
        roughness={0.5}
      />
      <Text
        position={[0, 0, 0.06]}
        fontSize={0.3}
        color={isSelected ? "#ffffff" : "#000000"}
      >
        {date.getDate()}
      </Text>
    </mesh>
  );
};

const CalendarGrid: React.FC<{
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}> = ({ selectedDate, onSelectDate }) => {
  const daysInMonth = new Date(
    selectedDate.getFullYear(),
    selectedDate.getMonth() + 1,
    0
  ).getDate();

  return (
    <group position={[-3, 2, 0]}>
      {Array.from({ length: daysInMonth }).map((_, index) => {
        const date = new Date(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          index + 1
        );
        const x = (index % 7) * 1;
        const y = -Math.floor(index / 7) * 1;

        return (
          <DayBlock
            key={index}
            date={date}
            position={new THREE.Vector3(x, y, 0)}
            isSelected={date.getDate() === selectedDate.getDate()}
            onClick={() => onSelectDate(date)}
          />
        );
      })}
    </group>
  );
};

const facts = {
  "1-1": "New Year's Day - Time to set new resolutions!",
  "12-25": "Christmas Day - A time for giving and celebration",
  // Add more facts for different dates
};

const CalendarView = () => {
  const [selectedDate, setSelectedDate] = useState(new Date());

  const getFact = (date: Date) => {
    const key = `${date.getMonth() + 1}-${date.getDate()}`;
    return (
      facts[key as keyof typeof facts] ||
      "No interesting fact for this day... yet!"
    );
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      <div className="flex-1">
        <Canvas camera={{ position: [0, 0, 10], fov: 50 }}>
          <OrbitControls enableZoom={false} />
          <ambientLight intensity={0.5} />
          <pointLight position={[10, 10, 10]} intensity={1} />
          <CalendarGrid
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
        </Canvas>
      </div>
      <div className="bg-white p-6 shadow-lg">
        <h2 className="text-3xl font-bold mb-4">
          {selectedDate.toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </h2>
        <p className="text-gray-600 text-lg">{getFact(selectedDate)}</p>
      </div>
    </div>
  );
};

export default CalendarView;
