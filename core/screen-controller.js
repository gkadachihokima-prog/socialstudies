export function showScreen(targetScreen, allScreens) {
  allScreens.forEach((screen) => {
    screen.classList.remove("active");
  });

  targetScreen.classList.add("active");
}

export function showHomeScreen(homeScreen, allScreens) {
  showScreen(homeScreen, allScreens);
}

export function showQuizScreen(quizScreen, allScreens) {
  showScreen(quizScreen, allScreens);
}

export function showResultScreen(resultScreen, allScreens) {
  showScreen(resultScreen, allScreens);
}

export function showStartScreen(startScreen, allScreens) {
  showScreen(startScreen, allScreens);
}

export function showHistoryScreen(historyScreen, allScreens) {
  showScreen(historyScreen, allScreens);
}

export function showHistoryDetailScreen(historyDetailScreen, allScreens) {
  showScreen(historyDetailScreen, allScreens);
}

export function showWeaknessScreen(weaknessScreen, allScreens) {
  showScreen(weaknessScreen, allScreens);
}

export function showWeaknessDetailScreen(weaknessDetailScreen, allScreens) {
  showScreen(weaknessDetailScreen, allScreens);
}

export function showTeacherScreen(teacherScreen, allScreens) {
  showScreen(teacherScreen, allScreens);
}

export function showTestSetStudentScreen(testSetStudentScreen, allScreens) {
  showScreen(testSetStudentScreen, allScreens);
}
