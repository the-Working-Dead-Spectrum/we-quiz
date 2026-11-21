import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create demo user
  const passwordHash = await bcrypt.hash('password123', 10);

  const user = await prisma.user.upsert({
    where: { email: 'demo@fastquizz.clone' },
    update: {},
    create: {
      email: 'demo@fastquizz.clone',
      passwordHash,
      name: 'Demo User',
    },
  });

  console.log('✅ Created demo user:', user.email);

  // Create sample quiz
  const quiz = await prisma.quiz.create({
    data: {
      title: 'General Knowledge Quiz',
      description: 'Test your general knowledge with this fun quiz!',
      authorId: user.id,
      questions: {
        create: [
          {
            text: 'What is the capital of France?',
            timeLimit: 20,
            pointsMultiplier: 1.0,
            orderIndex: 0,
            options: {
              create: [
                { text: 'London', isCorrect: false, colorIndex: 0 },
                { text: 'Paris', isCorrect: true, colorIndex: 1 },
                { text: 'Berlin', isCorrect: false, colorIndex: 2 },
                { text: 'Madrid', isCorrect: false, colorIndex: 3 },
              ],
            },
          },
          {
            text: 'Which planet is known as the Red Planet?',
            timeLimit: 15,
            pointsMultiplier: 1.0,
            orderIndex: 1,
            options: {
              create: [
                { text: 'Venus', isCorrect: false, colorIndex: 0 },
                { text: 'Mars', isCorrect: true, colorIndex: 1 },
                { text: 'Jupiter', isCorrect: false, colorIndex: 2 },
                { text: 'Saturn', isCorrect: false, colorIndex: 3 },
              ],
            },
          },
          {
            text: 'What is the largest ocean on Earth?',
            timeLimit: 20,
            pointsMultiplier: 1.5,
            orderIndex: 2,
            options: {
              create: [
                { text: 'Atlantic Ocean', isCorrect: false, colorIndex: 0 },
                { text: 'Indian Ocean', isCorrect: false, colorIndex: 1 },
                { text: 'Pacific Ocean', isCorrect: true, colorIndex: 2 },
                { text: 'Arctic Ocean', isCorrect: false, colorIndex: 3 },
              ],
            },
          },
          {
            text: 'Who wrote "Romeo and Juliet"?',
            timeLimit: 15,
            pointsMultiplier: 1.0,
            orderIndex: 3,
            options: {
              create: [
                { text: 'Charles Dickens', isCorrect: false, colorIndex: 0 },
                { text: 'William Shakespeare', isCorrect: true, colorIndex: 1 },
                { text: 'Jane Austen', isCorrect: false, colorIndex: 2 },
                { text: 'Mark Twain', isCorrect: false, colorIndex: 3 },
              ],
            },
          },
          {
            text: 'What is the chemical symbol for gold?',
            timeLimit: 10,
            pointsMultiplier: 1.0,
            orderIndex: 4,
            options: {
              create: [
                { text: 'Go', isCorrect: false, colorIndex: 0 },
                { text: 'Gd', isCorrect: false, colorIndex: 1 },
                { text: 'Au', isCorrect: true, colorIndex: 2 },
                { text: 'Ag', isCorrect: false, colorIndex: 3 },
              ],
            },
          },
        ],
      },
    },
    include: {
      questions: {
        include: { options: true },
        orderBy: { orderIndex: 'asc' },
      },
    },
  });

  console.log('✅ Created sample quiz:', quiz.title);
  console.log(`   ${quiz.questions.length} questions created`);

  console.log('🎉 Seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });