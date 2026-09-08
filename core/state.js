function createSessionState() {
  return {
    studentName: "",
    studentId: "",
    subject: "",
    unitFilter: "all",
    modeFilter: "all",
    subunitFilter: "all",
    requestedQuestionCount: 20,
    retryWrongEnabled: true,
    activeStudents: [],
    questionCacheBySubject: {}
  };
}

function createQuizState() {
  return {
    allQuestions: [],
    quizQuestions: [],
    currentIndex: 0,
    score: 0,
    currentQuestion: null,
    wrongQuestions: [],
    retryMode: false,
    firstRoundScore: 0,
    firstRoundTotal: 0
  };
}

function createUiState() {
  return {
    answered: false,
    selectedChoice: "",
    currentSortOrder: [],
    selectedMapArea: "",
    selectedMapAreaId: ""
  };
}

function resetObject(target, source) {
  Object.keys(target).forEach((key) => {
    delete target[key];
  });
  Object.assign(target, source);
}

export function resetSessionState(state) {
  resetObject(state.session, createSessionState());
}

export function resetQuizState(state) {
  resetObject(state.quiz, createQuizState());
}

export function resetUiState(state) {
  resetObject(state.ui, createUiState());
}

export function resetTransientQuizState(state) {
  resetQuizState(state);
  resetUiState(state);
}

export const state = {
  session: createSessionState(),
  quiz: createQuizState(),
  ui: createUiState()
};

Object.defineProperties(state, {
  studentName: {
    get() {
      return state.session.studentName;
    },
    set(value) {
      state.session.studentName = value;
    }
  },
  studentId: {
    get() {
      return state.session.studentId;
    },
    set(value) {
      state.session.studentId = value;
    }
  },
  subject: {
    get() {
      return state.session.subject;
    },
    set(value) {
      state.session.subject = value;
    }
  },
  unitFilter: {
    get() {
      return state.session.unitFilter;
    },
    set(value) {
      state.session.unitFilter = value;
    }
  },
  modeFilter: {
    get() {
      return state.session.modeFilter;
    },
    set(value) {
      state.session.modeFilter = value;
    }
  },
  subunitFilter: {
    get() {
      return state.session.subunitFilter;
    },
    set(value) {
      state.session.subunitFilter = value;
    }
  },
  requestedQuestionCount: {
    get() {
      return state.session.requestedQuestionCount;
    },
    set(value) {
      state.session.requestedQuestionCount = value;
    }
  },
  retryWrongEnabled: {
    get() {
      return state.session.retryWrongEnabled;
    },
    set(value) {
      state.session.retryWrongEnabled = value;
    }
  },
  activeStudents: {
    get() {
      return state.session.activeStudents;
    },
    set(value) {
      state.session.activeStudents = value;
    }
  },
  questionCacheBySubject: {
    get() {
      return state.session.questionCacheBySubject;
    },
    set(value) {
      state.session.questionCacheBySubject = value;
    }
  },
  allQuestions: {
    get() {
      return state.quiz.allQuestions;
    },
    set(value) {
      state.quiz.allQuestions = value;
    }
  },
  quizQuestions: {
    get() {
      return state.quiz.quizQuestions;
    },
    set(value) {
      state.quiz.quizQuestions = value;
    }
  },
  currentIndex: {
    get() {
      return state.quiz.currentIndex;
    },
    set(value) {
      state.quiz.currentIndex = value;
    }
  },
  score: {
    get() {
      return state.quiz.score;
    },
    set(value) {
      state.quiz.score = value;
    }
  },
  currentQuestion: {
    get() {
      return state.quiz.currentQuestion;
    },
    set(value) {
      state.quiz.currentQuestion = value;
    }
  },
  wrongQuestions: {
    get() {
      return state.quiz.wrongQuestions;
    },
    set(value) {
      state.quiz.wrongQuestions = value;
    }
  },
  retryMode: {
    get() {
      return state.quiz.retryMode;
    },
    set(value) {
      state.quiz.retryMode = value;
    }
  },
  firstRoundScore: {
    get() {
      return state.quiz.firstRoundScore;
    },
    set(value) {
      state.quiz.firstRoundScore = value;
    }
  },
  firstRoundTotal: {
    get() {
      return state.quiz.firstRoundTotal;
    },
    set(value) {
      state.quiz.firstRoundTotal = value;
    }
  },
  answered: {
    get() {
      return state.ui.answered;
    },
    set(value) {
      state.ui.answered = value;
    }
  },
  selectedChoice: {
    get() {
      return state.ui.selectedChoice;
    },
    set(value) {
      state.ui.selectedChoice = value;
    }
  },
  currentSortOrder: {
    get() {
      return state.ui.currentSortOrder;
    },
    set(value) {
      state.ui.currentSortOrder = value;
    }
  },
  selectedMapArea: {
    get() {
      return state.ui.selectedMapArea;
    },
    set(value) {
      state.ui.selectedMapArea = value;
    }
  },
  selectedMapAreaId: {
    get() {
      return state.ui.selectedMapAreaId;
    },
    set(value) {
      state.ui.selectedMapAreaId = value;
    }
  }
});